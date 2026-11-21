import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { syncWorkflow, fetchProjectNodes } from '@/lib/db-nodes';
import { reduceIntents, wouldCreateCycle, type RemovedEdge } from '@/lib/node-types';
import { getProjectLockState, assertWorkflowEditable } from '@/lib/lock-utils';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * 更新节点字段。
 * - type 由系统根据前置节点关系自动判断，客户端传值将被忽略；
 * - 修改前置节点时校验循环依赖（A→B→A 将被拒绝）；
 * - 更新后重算受影响节点的类型并返回全量节点。
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const client = getSupabaseClient();

    // 读取当前节点（确定所属项目）
    const { data: existing, error: existingError } = await client
      .from('nodes')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw new Error(`查询节点失败: ${existingError.message}`);
    if (!existing) return NextResponse.json({ error: '节点不存在' }, { status: 404 });

    const patch: Record<string, unknown> = {};

    // 锁定校验：读取项目 lock_state，按变更字段集合判定是否允许修改
    const { lockState } = await getProjectLockState(client, existing.project_id);
    const changedFields = Object.keys(body);
    const lockCheck = assertWorkflowEditable(lockState, changedFields);
    if (!lockCheck.ok) return NextResponse.json({ error: lockCheck.error }, { status: 403 });
    // 变更前全量节点快照与已简化的边（做差集基准，让 removedEdges 只含「本次新增」的简化边；
    // 必须在 update 之前计算，改名等不涉及依赖的更新才不会误报历史简化）
    const allBefore = await fetchProjectNodes(existing.project_id);
    const prevRemoved = reduceIntents(allBefore).removedEdges;
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: '节点名称不能为空' }, { status: 400 });
      patch.name = name;
    }
    // 类型不接收客户端写入：由系统根据前置关系自动判断

    // 负责人多选：assignees 为存库真相，sync 到 assignee(assignees[0]) 兼容旧调用；
    // 兼容旧字段 assignee：传了 assignee 则视为单负责人写回 assignees
    if (body.assignees !== undefined) {
      const arr = Array.isArray(body.assignees) ? body.assignees.map((a: unknown) => String(a).trim()).filter(Boolean) : [];
      if (arr.length === 0) return NextResponse.json({ error: '至少选择一位负责人' }, { status: 400 });
      patch.assignees = arr;
      patch.assignee = arr[0];
    } else if (body.assignee !== undefined) {
      const single = body.assignee === '' ? null : String(body.assignee).trim();
      patch.assignee = single;
      patch.assignees = single ? [single] : [];
    }

    // 点状 / DDL 型切换：互斥清理
    if (body.node_kind !== undefined) {
      const kind = String(body.node_kind);
      if (kind !== 'ddl' && kind !== 'point') {
        return NextResponse.json({ error: '不支持的节点形态' }, { status: 400 });
      }
      if (kind === 'point') {
        patch.node_kind = 'point';
        patch.ddl = null;
      } else {
        patch.node_kind = 'ddl';
        patch.point_date = null;
        patch.point_start_time = null;
        patch.point_end_time = null;
        patch.point_all_day = true;
      }
    }
    if (body.ddl !== undefined) {
      const v = body.ddl === '' || body.ddl === null ? null : String(body.ddl);
      patch.ddl = v;
      if (v) {
        patch.node_kind = 'ddl';
        patch.point_date = null;
        patch.point_start_time = null;
        patch.point_end_time = null;
        patch.point_all_day = true;
      }
    }
    if (body.point_date !== undefined) {
      const v = body.point_date === '' || body.point_date === null ? null : String(body.point_date);
      patch.point_date = v;
      if (v) {
        patch.node_kind = 'point';
        patch.ddl = null;
      } else {
        patch.point_start_time = null;
        patch.point_end_time = null;
      }
    }
    if (body.point_all_day !== undefined) {
      const abd = Boolean(body.point_all_day);
      patch.point_all_day = abd;
      if (abd) {
        patch.point_start_time = null;
        patch.point_end_time = null;
      }
    }
    if (body.point_start_time !== undefined) patch.point_start_time = body.point_start_time === '' ? null : String(body.point_start_time);
    if (body.point_end_time !== undefined) patch.point_end_time = body.point_end_time === '' ? null : String(body.point_end_time);

    if (body.note !== undefined) patch.note = String(body.note ?? '');

    // 状态操作（新语义）：todo(默认/取消标记) / done(已完成) / blocked(卡住了)
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!['todo', 'done', 'blocked'].includes(status)) {
        return NextResponse.json({ error: '不支持的节点状态' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      if (status === 'done') {
        patch.status = 'done';
        if (existing.status !== 'done') patch.completed_at = nowIso;
      } else if (status === 'blocked') {
        const noteText = body.blocked_note !== undefined ? String(body.blocked_note).trim() : existing.blocked_note;
        if (!noteText || noteText.length < 2) {
          return NextResponse.json({ error: '请填写卡住说明（至少 2 个字）' }, { status: 400 });
        }
        patch.status = 'blocked';
        patch.blocked_note = noteText;
        patch.completed_at = null;
      } else {
        // todo：取消标记，清空完成时间与卡住说明
        patch.status = 'todo';
        patch.completed_at = null;
        patch.blocked_note = null;
      }
    }
    if (body.blocked_note !== undefined) {
      const noteText = String(body.blocked_note ?? '').trim();
      if (noteText.length >= 2) {
        patch.blocked_note = noteText;
      }
    }
    if (body.position !== undefined) patch.position = body.position;
    if (body.prev_node_ids !== undefined) {
      const prevs = Array.isArray(body.prev_node_ids) ? body.prev_node_ids : [];
      // 循环依赖校验（基准：intent 全集，prev_node_ids 只做派生视图）
      if (wouldCreateCycle(id, prevs, allBefore)) {
        return NextResponse.json({ error: '不能设置前置节点：会形成循环依赖（A→B→A）' }, { status: 400 });
      }
      // 用户勾选写入 intent（完整声明，不做约简）
      patch.intent_prev_node_ids = prevs;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data: nodes, error } = await client
      .from('nodes')
      .update(patch)
      .eq('id', id)
      .select('*');
    if (error) throw new Error(`更新节点失败: ${error.message}`);
    if (!nodes || nodes.length === 0) return NextResponse.json({ error: '节点不存在' }, { status: 404 });
    const node = nodes[0];

    // 依据依赖意图执行全量同步：约简写回有效边 → 拓扑重排 → 类型重算
    const { nodes: allNodes, removedEdges } = await syncWorkflow(node.project_id, prevRemoved);
    const updatedNode = allNodes.find((n) => n.id === id) ?? node;

    return NextResponse.json({ node: updatedNode, nodes: allNodes, removedEdges });
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新节点失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 删除节点：
 * 1. 移除其他节点对它的前置引用（出度变化会连锁影响类型）；
 * 2. 重算剩余节点类型；
 * 3. 返回删除后的全量节点。
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = getSupabaseClient();

    const { data: existing, error: existingError } = await client
      .from('nodes')
      .select('project_id')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw new Error(`查询节点失败: ${existingError.message}`);
    if (!existing) return NextResponse.json({ error: '节点不存在' }, { status: 404 });
    const projectId = existing.project_id as string;

    // 锁定校验：工作流/完全锁定后禁止删除节点
    const { lockState } = await getProjectLockState(client, projectId);
    if (lockState !== 'none') {
      return NextResponse.json({ error: '项目已锁定，无法删除任务。请在项目总览中解锁。' }, { status: 403 });
    }

    // 记录删除前已简化的边（做差集基准，保证 syncWorkflow 的 removedEdges 只含新增简化）
    const allBefore = await fetchProjectNodes(projectId);
    const prevRemoved = reduceIntents(allBefore).removedEdges;

    // 移除其他节点对该节点的前置引用：intent（用户勾选全集）与 prev_node_ids（派生视图）都要清理。
    // prev_node_ids 由 syncWorkflow 从 intent 全量重算，这里只需清理 intent；
    // 若被删节点曾在某节点 intent 里，删掉引用后该边不再存在，不会被恢复。
    const { data: dependants, error: depError } = await client
      .from('nodes')
      .select('id, intent_prev_node_ids')
      .eq('project_id', projectId);
    if (depError) throw new Error(`查询引用节点失败: ${depError.message}`);
    for (const dep of dependants ?? []) {
      const intents = dep.intent_prev_node_ids as string[];
      if (intents.includes(id)) {
        const next = intents.filter((p) => p !== id);
        const { error: updError } = await client
          .from('nodes')
          .update({ intent_prev_node_ids: next, updated_at: new Date().toISOString() })
          .eq('id', dep.id);
        if (updError) throw new Error(`解除节点引用失败: ${updError.message}`);
      }
    }

    const { data, error: deleteError } = await client.from('nodes').delete().eq('id', id).select('id');
    if (deleteError) throw new Error(`删除节点失败: ${deleteError.message}`);
    if (!data || data.length === 0) return NextResponse.json({ error: '节点不存在' }, { status: 404 });

    // 依据剩余依赖关系执行全量同步：传递约简 → 拓扑重排 → 类型重算
    const { nodes: allNodes, removedEdges } = await syncWorkflow(projectId, prevRemoved);

    return NextResponse.json({ success: true, nodes: allNodes, removedEdges });
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除节点失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}