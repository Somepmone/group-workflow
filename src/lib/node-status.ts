// 节点状态派生（纯函数，不依赖 React / 服务端）
// 核心原则：status 只存用户主动设置的 done/blocked/todo；
// 「未开始 / 进行中 / 已超时」由当前时间与节点时间区间实时计算，不写库。
import type { NodeDerivedState, NodeTimeRange, WorkflowNode } from './types';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 当天结束（23:59:59.999），用于 DDL 与点状节点的"完成时刻"边界 */
function endOfDay(dayKey: string): Date {
  const d = new Date(`${dayKey}T23:59:59.999`);
  return d;
}

/**
 * 节点"完成时刻"：
 * - DDL 型：ddl 当天结束（与时间轴方案 A 一致，避免 DDL 当天 00:00 就判定超时）
 * - 点状节点：point_date 当天 23:59（All day 或时间段统一按当天计）
 * 无对应日期时返回 null（该节点无时间边界，永不超时）。
 */
export function nodeEndTime(node: WorkflowNode): Date | null {
  if (node.node_kind === 'point') {
    if (!node.point_date) return null;
    return endOfDay(node.point_date);
  }
  if (!node.ddl) return null;
  const iso = node.ddl.length >= 10 ? node.ddl.slice(0, 10) : node.ddl;
  return endOfDay(iso);
}

function isValidId(id: string | undefined | null): id is string {
  return Boolean(id);
}

/**
 * 节点时间区间：
 * - 起点 = 所有前置节点完成时刻的最晚值；无前置 = 项目最早完成时刻 或 今天（取较晚者）
 * - 终点 = 自身完成时刻（nodeEndTime）
 * 返回 null 表示该节点没有时间边界（未排期），派生逻辑按"进行中、不超时"处理。
 */
export function computeNodeRange(node: WorkflowNode, allNodes: WorkflowNode[]): NodeTimeRange {
  const end = nodeEndTime(node);

  // 前置完成时刻最晚值
  const prevIds = (node.prev_node_ids || []).filter(isValidId);
  const prevEnds = prevIds
    .map((pid) => allNodes.find((n) => n.id === pid))
    .map((pn) => (pn ? nodeEndTime(pn) : null))
    .filter((d): d is Date => Boolean(d));

  let start: Date | null = null;
  if (prevEnds.length > 0) {
    start = new Date(Math.max(...prevEnds.map((d) => d.getTime())));
  }
  // 无前置 → start 保持 null（视为随时可开始，不做「未开始」判断）
  // 修复：此前把无前置算成「全项目最早 DDL 当天结束」，会误判最早任务为「未开始」；时间轴几何一直是「无前置 → 轴最左端」，两处现已一致

  return { start, end };
}

/** 超时文案：不足 1 小时显示「已超时不足 1 小时」，1~23 小时显示小时数，>=24 小时显示天数 */
export function overdueLabel(endTime: Date, now: Date): string {
  const diff = Math.max(now.getTime() - endTime.getTime(), 0);
  const hours = Math.floor(diff / HOUR);
  if (hours < 1) return '已超时不足 1 小时';
  if (hours < 24) return `已超时 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `已超时 ${days} 天`;
}

/**
 * 派生状态主入口：
 * 1. status==='done' → 已完成（completedAt 取 completed_at）
 * 2. status==='blocked' → 卡住了
 * 3. 否则按时间：now<起点 → 前置全部完成则「可进行(ready)」否则「未开始」；
 *    起点<=now<=终点 进行中 / now>终点 已超时
 * 无时间边界的节点 → 进行中（不超时）。无前置 → start=null（随时可开始，不做未开始判断）。
 */
export function deriveNodeStatus(node: WorkflowNode, allNodes: WorkflowNode[], now: Date = new Date()): NodeDerivedState {
  if (node.status === 'done') {
    return { status: 'done', overdueLabel: '', isOverdue: false, completedAt: node.completed_at ?? now.toISOString() };
  }
  if (node.status === 'blocked') {
    return { status: 'blocked', overdueLabel: '', isOverdue: false, completedAt: null };
  }

  const { start, end } = computeNodeRange(node, allNodes);
  if (!end) {
    return { status: 'in_progress', overdueLabel: '', isOverdue: false, completedAt: null };
  }
  if (start && now.getTime() < start.getTime()) {
    // 未到计划开始时间：前置全部已完成 → 可进行（随时能开始）；否则未开始
    const prevIds = (node.prev_node_ids || []).filter(Boolean);
    const prevNodes = prevIds
      .map((pid) => allNodes.find((n) => n.id === pid))
      .filter((n): n is WorkflowNode => Boolean(n));
    const allPrevDone = prevNodes.length > 0 && prevNodes.every((pn) => pn.status === 'done');
    if (allPrevDone) {
      return { status: 'ready', overdueLabel: '', isOverdue: false, completedAt: null };
    }
    return { status: 'not_started', overdueLabel: '', isOverdue: false, completedAt: null };
  }
  if (now.getTime() > end.getTime()) {
    return { status: 'overdue', overdueLabel: overdueLabel(end, now), isOverdue: true, completedAt: null };
  }
  return { status: 'in_progress', overdueLabel: '', isOverdue: false, completedAt: null };
}