import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { deriveNodeStatus } from '@/lib/node-status';
import type { WorkflowNode } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CommentAgg {
  node_id: string;
  commentCount: number;
  helpCount: number;
  lastCommentAt: string | null;
}

/**
 * 个人任务聚合：返回该昵称在所有项目里被指派为负责人的节点（跨项目）。
 * 匹配规则：assignees 数组包含该名字（精确匹配）。
 * commentCount / helpCount / lastCommentAt 一次查询聚合，不 N+1。
 * 返回前按派生状态 + 截止时间排序（已完成排最后，其余按时间升序）。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = (searchParams.get('name') ?? '').trim();
    if (!name) return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 });

    const client = getSupabaseClient();

    // 1. 拉取该昵称负责的全部节点（assignees jsonb 数组包含 name）
    const { data: rawNodes, error: nodeError } = await client
      .from('nodes')
      .select('*')
      .filter('assignees', 'cs', JSON.stringify([name]))
      .order('position', { ascending: true });
    if (nodeError) throw new Error(`查询节点失败: ${nodeError.message}`);
    const nodes = (rawNodes ?? []) as WorkflowNode[];

    const projectIds = nodes.length > 0 ? [...new Set(nodes.map((n) => n.project_id))] : [];

    // 2. 按 projectId 一次性拉取涉及项目的【全量节点】（派生状态必须用项目全量计算，
    //    不能用当前用户节点子集——否则跨用户前置节点缺失，start 退化为 null 导致状态误判）
    //    同时按 projectId 分组缓存，供每条用户节点查找其所属项目全量节点，不 N+1。
    const allNodesByProject: Record<string, WorkflowNode[]> = {};
    if (projectIds.length > 0) {
      const { data: projectNodes, error: allError } = await client
        .from('nodes')
        .select('*')
        .in('project_id', projectIds);
      if (allError) throw new Error(`查询项目节点失败: ${allError.message}`);
      (projectNodes ?? []).forEach((pn: WorkflowNode) => {
        (allNodesByProject[pn.project_id] ??= []).push(pn);
      });
    }

    // 3. 一次性拉取涉及的评论（按 project 索引组装聚合，避免对每个节点 N+1）
    const commentAgg: Record<string, CommentAgg> = {};
    if (nodes.length > 0) {
      const nodeIds = nodes.map((n) => n.id);
      const { data: comments, error: commentError } = await client
        .from('node_comments')
        .select('node_id, kind, created_at')
        .in('node_id', nodeIds);
      if (commentError) throw new Error(`查询评论失败: ${commentError.message}`);
      (comments ?? []).forEach((c: { node_id: string; kind: string; created_at: string }) => {
        const prev = commentAgg[c.node_id] ?? { node_id: c.node_id, commentCount: 0, helpCount: 0, lastCommentAt: null };
        prev.commentCount += 1;
        if (c.kind === 'help') prev.helpCount += 1;
        if (!prev.lastCommentAt || c.created_at > prev.lastCommentAt) prev.lastCommentAt = c.created_at;
        commentAgg[c.node_id] = prev;
      });
    }

    // 4. 项目名映射（一次查询所有涉及项目）
    let projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const { data: projects, error: projectError } = await client
        .from('projects')
        .select('id, name')
        .in('id', projectIds);
      if (projectError) throw new Error(`查询项目失败: ${projectError.message}`);
      projectNames = Object.fromEntries((projects ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
    }

    const now = new Date();
    const list = nodes.map((n) => {
      // 该节点所属项目的全量节点（含跨用户的前置/后继），用于正确的派生状态计算
      const projectAllNodes = allNodesByProject[n.project_id] ?? [n];
      const derived = deriveNodeStatus(n, projectAllNodes, now);
      const agg = commentAgg[n.id];
      // 排序键：派生状态优先级 + 截止时刻
      const end = derived.status === 'done' ? new Date(n.completed_at ?? 0).getTime() : endTime(n) ?? Number.MAX_SAFE_INTEGER;
      return {
        id: n.id,
        projectId: n.project_id,
        projectName: projectNames[n.project_id] ?? '未知项目',
        name: n.name,
        nodeKind: n.node_kind,
        ddl: n.ddl,
        pointDate: n.point_date,
        pointAllDay: n.point_all_day,
        pointStartTime: n.point_start_time,
        pointEndTime: n.point_end_time,
        assignees: n.assignees && n.assignees.length > 0 ? n.assignees : (n.assignee ? [n.assignee] : []),
        status: n.status,
        blockedNote: n.blocked_note,
        completedAt: n.completed_at,
        note: n.note,
        prevNodeIds: n.prev_node_ids ?? [],
        derivedStatus: derived.status,
        overdueLabel: derived.overdueLabel,
        sortKey: `${derived.status === 'done' ? 9 : derived.status === 'blocked' ? 8 : 0}-${end}`,
        commentCount: agg?.commentCount ?? 0,
        helpCount: agg?.helpCount ?? 0,
        lastCommentAt: agg?.lastCommentAt ?? null,
      };
    });

    // 排序：未完成（未开始/进行中/已超时/卡住）在前按 DDL 升序，已完成最后
    list.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    return NextResponse.json({ nodes: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取我的任务失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 节点截止时刻（ms）：DDL 当天结束 / 点状当天 23:59；无时间返回 null */
function endTime(node: WorkflowNode): number | null {
  if (node.node_kind === 'point' && node.point_date) {
    return new Date(`${node.point_date}T23:59:59.999`).getTime();
  }
  if (node.ddl) {
    const day = node.ddl.slice(0, 10);
    return new Date(`${day}T23:59:59.999`).getTime();
  }
  return null;
}