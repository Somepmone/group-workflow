import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { buildTemplateNodes } from '@/lib/templates';
import { syncNodeTypes } from '@/lib/db-nodes';
import type { ProjectTemplate } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** 项目列表（首页卡片）：项目 + 节点数 + 成员数 + 最近更新时间 + 锁定标识 */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data: projects, error: projectError } = await client
      .from('projects')
      .select('id, name, template, owner_name, lock_state, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);

    if (!projects || projects.length === 0) return NextResponse.json({ projects: [] });

    // 节点数与成员数聚合（一次性，不 N+1）
    const [{ data: nodeRows }, { data: memberRows }] = await Promise.all([
      client.from('nodes').select('project_id, id'),
      client.from('members').select('project_id, id, name'),
    ]);
    const nodeCount = new Map<string, number>();
    const memberNames = new Map<string, { name: string }[]>();
    (nodeRows ?? []).forEach((r) => nodeCount.set(r.project_id, (nodeCount.get(r.project_id) ?? 0) + 1));
    (memberRows ?? []).forEach((r) => {
      const list = memberNames.get(r.project_id) ?? [];
      list.push({ name: r.name as string });
      memberNames.set(r.project_id, list);
    });

    const list = (projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template,
      owner_name: p.owner_name,
      lock_state: (p.lock_state ?? 'none') as string,
      created_at: p.created_at,
      updated_at: p.updated_at,
      nodeCount: nodeCount.get(p.id) ?? 0,
      members: memberNames.get(p.id) ?? [],
    }));

    return NextResponse.json({ projects: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取项目列表失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 创建项目：项目 + 组长成员 + 模板默认节点（一次事务完成） */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    const ownerName = String(body.ownerName ?? '').trim();
    const template = (String(body.template ?? 'blank') as ProjectTemplate);

    if (!name) return NextResponse.json({ error: '项目名不能为空' }, { status: 400 });
    if (!ownerName) return NextResponse.json({ error: '请输入你的昵称' }, { status: 400 });

    const client = getSupabaseClient();

    // 1. 插入项目
    const { data: project, error: projectError } = await client
      .from('projects')
      .insert({ name, template, owner_name: ownerName })
      .select('*')
      .single();
    if (projectError) throw new Error(`创建项目失败: ${projectError.message}`);

    // 2. 组长自动加入成员
    const { error: memberError } = await client
      .from('members')
      .insert({ project_id: project.id, name: ownerName });
    if (memberError) throw new Error(`加入成员失败: ${memberError.message}`);

    // 3. 生成模板默认节点，并把节点间的依赖关系建立起来（依据模板显式依赖 prevIndexes）
    //    模板本身无冗余边：intent_prev_node_ids 与 prev_node_ids 写入相同值（双轨一致）
    const templateNodes = buildTemplateNodes(template);
    const insertRows = templateNodes.map((n) => ({
      project_id: project.id,
      name: n.name,
      type: n.type,
      strictness: n.strictness,
      assignees: n.assignees,
      assignee: n.assignees[0] ?? null,
      node_kind: n.node_kind,
      point_date: n.point_date,
      point_all_day: n.point_all_day,
      point_start_time: n.point_start_time,
      point_end_time: n.point_end_time,
      note: n.note,
      prev_node_ids: [],
      intent_prev_node_ids: [],
      status: n.status,
      position: n.position,
    }));

    const { data: insertedNodes, error: nodesError } = await client
      .from('nodes')
      .insert(insertRows)
      .select('id, name, position, type');
    if (nodesError) throw new Error(`创建默认节点失败: ${nodesError.message}`);

    // 依据模板显式依赖（prevIndexes，即模板数组下标）建立真实 DAG：
    // 课程汇报：选题 →(分叉)→ 资料收集∥大纲撰写 →(汇聚)→ 内容整合 → 排版 → 预演
    if (insertedNodes && insertedNodes.length > 1) {
      const positions = new Map(insertedNodes.map((d: { id: string; position: number }) => [d.position, d.id]));
      const updates: { id: string; prev_node_ids: string[] }[] = [];
      templateNodes.forEach((def, idx) => {
        const nodeId = positions.get(def.position);
        if (!nodeId || def.prevIndexes.length === 0) return;
        const prevs = def.prevIndexes
          .map((pIdx) => positions.get(templateNodes[pIdx]?.position ?? -1))
          .filter((pid): pid is string => Boolean(pid));
        if (prevs.length > 0) updates.push({ id: nodeId, prev_node_ids: prevs });
      });

      for (const u of updates) {
        const { error: updateError } = await client
          .from('nodes')
          .update({
            prev_node_ids: u.prev_node_ids,
            intent_prev_node_ids: u.prev_node_ids,
            updated_at: new Date().toISOString(),
          })
          .eq('id', u.id);
        if (updateError) throw new Error(`更新节点依赖失败: ${updateError.message}`);
      }
    }

    // 依据依赖关系自动重算类型，确保模板节点类型与依赖一致（消除类型与依赖矛盾）
    await syncNodeTypes(project.id);

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建项目失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}