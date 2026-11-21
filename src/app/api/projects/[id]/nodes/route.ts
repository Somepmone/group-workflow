import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { syncWorkflow, fetchProjectNodes } from '@/lib/db-nodes';
import { reduceIntents, wouldCreateCycle } from '@/lib/node-types';
import { getProjectLockState } from '@/lib/lock-utils';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 新增节点（追加到末尾）。type 由系统根据前置关系自动判断，客户端传值被忽略 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: '节点名称不能为空' }, { status: 400 });

    const client = getSupabaseClient();

    // 确认项目存在
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // 锁定校验：工作流/完全锁定后禁止新增节点
    const { lockState } = await getProjectLockState(client, id);
    if (lockState !== 'none') {
      return NextResponse.json({ error: '项目已锁定，无法新增任务。请在项目总览中解锁。' }, { status: 403 });
    }

    const allBefore = await fetchProjectNodes(id);
    const prevs = Array.isArray(body.prev_node_ids) ? body.prev_node_ids : [];
    // 记录变更前已简化的边（做差集基准，removedEdges 只含本次新增的简化边）
    const prevRemoved = reduceIntents(allBefore).removedEdges;

    // 计算最大 position
    const position = allBefore.length > 0 ? (allBefore[allBefore.length - 1].position as number) + 1 : 0;

    // 插入：intent（用户勾选全集）与 prev_node_ids（暂存同样值，syncWorkflow 后将按 intent 约简）
    // assignees 为多选真相（默认 [assignee] 兼容旧调用），assignee 同步为 assignees[0]
    const rawAssignees = Array.isArray(body.assignees)
      ? body.assignees.map((a: unknown) => String(a).trim()).filter(Boolean)
      : body.assignee
        ? [String(body.assignee).trim()]
        : [];
    const assignees = rawAssignees.length > 0 ? rawAssignees : [];
    const nodeKind = body.node_kind === 'point' ? 'point' : 'ddl';
    const isPoint = nodeKind === 'point';
    // 点状节点互斥：设了 point_date 则清 ddl，设了 ddl 则退回 ddl 型
    const pointDate = isPoint && body.point_date ? String(body.point_date) : null;
    const ddl = !isPoint && body.ddl ? String(body.ddl) : null;

    const { data: node, error: insertError } = await client
      .from('nodes')
      .insert({
        project_id: id,
        name,
        type: 'linear',
        assignee: assignees[0] ?? null,
        assignees,
        ddl,
        strictness: 'soft',
        node_kind: nodeKind,
        point_date: pointDate,
        point_all_day: body.point_all_day !== false,
        point_start_time: !body.point_all_day && body.point_start_time ? String(body.point_start_time) : null,
        point_end_time: !body.point_all_day && body.point_end_time ? String(body.point_end_time) : null,
        note: body.note ? String(body.note) : '',
        prev_node_ids: prevs,
        intent_prev_node_ids: prevs,
        status: body.status === 'done' || body.status === 'blocked' ? body.status : 'todo',
        completed_at: body.status === 'done' ? new Date().toISOString() : null,
        blocked_note: body.status === 'blocked' ? String(body.blocked_note ?? '') : null,
        position,
      })
      .select('*')
      .single();
    if (insertError) throw new Error(`创建节点失败: ${insertError.message}`);

    // 环检测（基于 intent 全集：新节点自身作为前置、或前置链能追溯到新节点的场景）
    const allWithNew = await fetchProjectNodes(id);
    if (prevs.includes(node.id) || wouldCreateCycle(node.id, prevs, allWithNew)) {
      await client.from('nodes').delete().eq('id', node.id);
      return NextResponse.json({ error: '不能设置前置节点：会形成循环依赖（A→B→A）' }, { status: 400 });
    }

    // 依据依赖意图执行全量同步：约简写回有效边 → 拓扑重排 → 类型重算
    const { nodes: allNodes, removedEdges } = await syncWorkflow(id, prevRemoved);
    const newNode = allNodes.find((n) => n.id === node.id) ?? node;

    return NextResponse.json({ node: newNode, nodes: allNodes, removedEdges }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建节点失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}