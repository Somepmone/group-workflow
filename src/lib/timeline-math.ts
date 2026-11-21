import type { WorkflowNode } from '@/lib/types';

/**
 * 时间轴纯计算模块：时间范围 / 任务条几何。
 * 与 React 完全解耦，便于独立验证与测试。任何 NaN/Infinity 都会被 safeNum 拦截。
 */

export const DAY = 86400000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 兼容 'YYYY-MM-DD' / ISO datetime 的按本地日解析，避免时区偏移；解析失败返回 null */
export function parseDay(s?: string | null): Date | null {
  if (!s) return null;
  const parts = s.slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 节点的时间日：DDL 型取 ddl，点状节点取 point_date（点状无 ddl） */
export function nodeTimeDay(node: WorkflowNode): string | null {
  if (node.node_kind === 'point') return node.point_date ?? null;
  return node.ddl ?? null;
}

/** 时间计算保护：任何 NaN/Infinity 都必须拦截，避免无效值进入样式属性 */
export function safeNum(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export interface TimelineRange {
  rangeStart: Date;
  rangeEnd: Date;
  dayCount: number;
  weekly: boolean;
}

/**
 * 时间范围：只考虑「有时间」的节点（有 DDL 或点状日期，最小~最大 ±3 天，并保证包含今天）；
 * 空数组（无时间节点/空项目）防御性返回「今天起 14 天」；页面层应在过滤后自行判空走空状态。dayCount 恒 >= 1。
 */
export function computeTimelineRange(nodes: WorkflowNode[], today: Date): TimelineRange {
  const dts = nodes
    .map((n) => parseDay(nodeTimeDay(n)))
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  let rangeStart: Date;
  let rangeEnd: Date;
  if (dts.length === 0) {
    rangeStart = startOfDay(today);
    rangeEnd = addDays(today, 13);
  } else {
    const minT = Math.min(...dts);
    const maxT = Math.max(...dts);
    rangeStart = addDays(startOfDay(new Date(Math.min(minT, today.getTime()))), -3);
    rangeEnd = addDays(startOfDay(new Date(Math.max(maxT, today.getTime()))), 3);
  }
  const dayCount = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY) + 1);
  return { rangeStart, rangeEnd, dayCount, weekly: dayCount > 30 };
}

export interface BarGeom {
  /** 任务条起点像素（相对时间区起点） */
  x: number;
  /** 条宽（px），最小 24px */
  w: number;
  /**
   * 起点日（浮点）：所有有 DDL 前置节点的 ddl「当天结束」日序号 + 1（= startX 对应日），
   * 即前置任务在 DDL 当天结束时才算完成，下一条从该时刻开始；无前置 → 0（轴起点）。
   */
  startDay: number;
  /**
   * 终点日（浮点）：自身 ddl「当天结束」日序号 + 1；无 ddl → dayCount（轴右端）。
   * 渲染、泳道分配共用此函数返回的 startDay/endDay，禁止两处各算各的。
   */
  endDay: number;
  /** 依赖倒挂：前置最晚 ddl 当天结束晚于自身 ddl 当天结束 */
  inverted: boolean;
  /** 前置最晚 ddl 与自身 ddl 同日（条宽为 0，需最小宽 24px + 置顶可见 + tooltip 提示） */
  sameAsPrev: boolean;
}

/**
 * 任务条几何（所有渲染/泳道分配共用此函数，禁止两处各算各的）——方案 A「DDL 当天结束」：
 * - 起点 = 前置节点 ddl 最晚的【当天结束】(日序号 + 1)；无前置 → 0（轴起点）
 * - 终点 = 自身 ddl 的【当天结束】(日序号 + 1)；无 ddl → 延伸到时间轴右端
 * - 起点晚于终点 → 倒挂，最小宽度 24px；同日 → 条宽 0，最小宽度 24px 且 sameAsPrev=true
 * 注意：单位全局统一为「日序号 + 1（天末）」浮点天，与渲染 px 换算同源，避免重叠 1 天。
 */
export function computeBarGeom(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  range: TimelineRange,
  ppd: number
): BarGeom {
  const endD = parseDay(node.ddl);
  const prevs = (node.prev_node_ids ?? [])
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => Boolean(n));
  // 前置节点完成时刻：DDL 型 = ddl 当天结束；点状节点 = point_date 当天结束（统一按 23:59 计）
  const prevStartCandidates = prevs
    .map((p) => parseDay(nodeTimeDay(p)))
    .filter((d): d is Date => d !== null)
    .map((d) => (d.getTime() - range.rangeStart.getTime()) / DAY + 1); // 前置 DDL/点状日期当天结束
  // 起点 = 前置最晚完成时刻（绝不早于前置结束，绝不用前置「开始时间」）
  const startDay =
    prevStartCandidates.length > 0 ? Math.max(0, Math.max(...prevStartCandidates)) : 0;
  // 终点 = 自身 ddl 当天结束；无 ddl → 右端
  const endDay = endD
    ? Math.max(0, (endD.getTime() - range.rangeStart.getTime()) / DAY + 1)
    : range.dayCount;
  const inverted = Boolean(endD && startDay > endDay);
  const sameAsPrev = Boolean(endD && prevStartCandidates.length > 0 && startDay === endDay);
  const w = safeNum(Math.max(24, Math.max(0, endDay - startDay) * ppd), 24);
  return { x: safeNum(startDay * ppd), w, startDay, endDay, inverted, sameAsPrev };
}

/** 点状节点几何：菱形中心位于 point_date 对应列中心，垂直居中于第 0 条泳道（不参与泳道压缩） */
export interface PointGeom {
  /** 菱形中心像素 x（列中心：(dayIndex + 0.5) * ppd） */
  x: number;
  /** 所在列下标（相对轴起点，0 起） */
  dayIndex: number;
  /** 前置最晚完成时刻（天末日序号 +1）；无前置 → 0（连线起点用） */
  startDay: number;
  /** 自身完成时刻（天末日序号 +1，即 dayIndex + 1） */
  endDay: number;
}

export function computePointGeom(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  range: TimelineRange,
  ppd: number
): PointGeom | null {
  const day = parseDay(node.point_date);
  if (!day) return null;
  const dayIndex = Math.max(0, Math.round((day.getTime() - range.rangeStart.getTime()) / DAY));
  const prevs = (node.prev_node_ids ?? [])
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => Boolean(n));
  const prevEnds = prevs
    .map((p) => parseDay(nodeTimeDay(p)))
    .filter((d): d is Date => d !== null)
    .map((d) => (d.getTime() - range.rangeStart.getTime()) / DAY + 1);
  const startDay = prevEnds.length > 0 ? Math.max(0, Math.max(...prevEnds)) : 0;
  const endDay = dayIndex + 1;
  return { x: safeNum((dayIndex + 0.5) * ppd), dayIndex, startDay, endDay };
}

/**
 * 泳道（任务行合并）输入：startDay/endDay 为相对轴起点的【浮点天数（精确时刻）】，
 * 必须与 computeBarGeom 返回的 startDay/endDay 完全一致（共用同一几何计算）。
 */
export interface LaneInput {
  nodeId: string;
  startDay: number;
  endDay: number;
  /** 直接前置节点 id，用于「多条可用泳道时优先复用直接前置所在泳道」 */
  prevNodeIds: string[];
}

/**
 * 泳道分配（时间不重叠压缩）：
 * 1. 按 (拓扑序 → 开始时刻升序) 遍历所有节点
 * 2. 对每个节点，在已有泳道中找「与泳道内所有任务区间均不相交」的泳道
 *    （首尾相接 end <= start 视为不重叠，可共享行）
 * 3. 多条可用时优先其直接前置所在泳道；无可用的新建一条
 * 4. 【硬性断言】选定泳道后若与同泳道任意任务 [start, end) 交集非空 → 回退新建泳道
 * 5. 泳道按首次使用顺序从上到下排列
 * 返回 nodeId → 泳道行号。
 */
export function assignLanes(inputs: LaneInput[]): Map<string, number> {
  const laneTasks: { start: number; end: number }[][] = [];
  const laneOfNode = new Map<string, number>();
  const res = new Map<string, number>();
  for (const it of inputs) {
    const start = Math.max(0, safeNum(it.startDay, 0));
    const end = Math.max(start, safeNum(it.endDay, it.startDay));
    const task = { start, end };
    const canPlace = (li: number) =>
      laneTasks[li].every((t) => t.end <= start || end <= t.start);
    const usable: number[] = [];
    laneTasks.forEach((_, li) => {
      if (canPlace(li)) usable.push(li);
    });
    let target: number | null = null;
    if (usable.length > 0) {
      const pref = it.prevNodeIds
        .map((p) => laneOfNode.get(p))
        .find((i): i is number => i !== undefined && usable.includes(i));
      target = pref ?? usable[0];
    }
    // 硬性断言：同泳道内任意两条 [start, end) 交集必须为空，违反则回退新建泳道
    if (target !== null) {
      const clash = laneTasks[target].some((t) => t.end > start && t.start < end);
      if (clash) target = null;
    }
    if (target === null) {
      target = laneTasks.length;
      laneTasks.push([task]);
    } else {
      laneTasks[target].push(task);
    }
    laneOfNode.set(it.nodeId, target);
    res.set(it.nodeId, target);
  }
  return res;
}