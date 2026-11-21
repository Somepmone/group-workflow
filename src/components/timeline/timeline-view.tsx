'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Member, WorkflowNode, DerivedStatus } from '@/lib/types';
import { DERIVED_STATUSES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { computeLevelsMap } from '@/lib/node-types';
import {
  formatCompletedAt,
  formatDDL,
  formatPointTime,
} from '@/lib/client-utils';
import { deriveNodeStatus } from '@/lib/node-status';
import {
  DAY,
  addDays,
  assignLanes,
  computeBarGeom,
  computePointGeom,
  computeTimelineRange,
  nodeTimeDay,
  parseDay,
  safeNum,
  startOfDay,
  type BarGeom,
  type PointGeom,
} from '@/lib/timeline-math';
import NodeDetailDialog from '@/components/board/node-detail-dialog';
import { AlertTriangle, Info, StickyNote } from 'lucide-react';
import Link from 'next/link';

const ROW_H = 44;
const HEADER_H = 36;

function fmtDay(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const TYPE_COLOR: Record<string, string> = { linear: '#0ea5e9', converge: '#f59e0b' };

interface TimelineViewProps {
  project: Project;
  members: Member[];
  nodes: WorkflowNode[];
  onUpdate: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
}

interface EdgeGeom {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TooltipState {
  node: WorkflowNode;
  left: number;
  top: number;
  inverted: boolean;
  sameAsPrev: boolean;
}

const statusText: Record<DerivedStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  ready: '可进行',
  overdue: '已超时',
  done: '已完成',
  blocked: '卡住了',
};

export default function TimelineView({ project, members, nodes, onUpdate }: TimelineViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const ppdRef = useRef<number>(24);
  const [ppd, setPpd] = useState<number>(24);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [detailNode, setDetailNode] = useState<WorkflowNode | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 今天（本地日）
  const today = useMemo(() => startOfDay(new Date()), []);

  // 时间轴只渲染「有时间」的节点：有 DDL 的条节点 + 有 point_date 的点状节点；其余不占泳道、不参与布局
  const timedNodes = useMemo(
    () => nodes.filter((n) => Boolean(nodeTimeDay(n))),
    [nodes]
  );
  // 条节点（有 DDL）参与泳道压缩；点状节点（菱形）不参与泳道分配
  const timedBars = useMemo(() => timedNodes.filter((n) => n.node_kind !== 'point'), [timedNodes]);
  const timedPoints = useMemo(() => timedNodes.filter((n) => n.node_kind === 'point'), [timedNodes]);

  // 时间范围：只考虑有时间节点（最小~最大 ±3 天，并保证包含今天）；空数组防御性今天起 14 天
  const range = useMemo(() => computeTimelineRange(timedNodes, today), [timedNodes, today]);

  // 每像素天宽：随容器宽度自适应（保底 24px/天，最大 96px/天），保证横向滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const vis = Math.max(el.clientWidth - 16, 200);
      const v = Math.max(24, Math.min(96, Math.floor(vis / Math.max(range.dayCount, 1))));
      if (Math.abs(v - ppdRef.current) > 0.5) {
        ppdRef.current = v;
        setPpd(v);
      }
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [range.dayCount]);

  // 行序：拓扑层级 + position 稳定排序（泳道输入的有序基础）——仅条节点
  const levelsMap = useMemo(() => computeLevelsMap(timedBars), [timedBars]);
  const rows = useMemo(
    () =>
      [...timedBars]
        .map((n) => ({ node: n, level: levelsMap.get(n.id) ?? 0 }))
        .sort((a, b) => (a.level - b.level) || (a.node.position ?? 0) - (b.node.position ?? 0)),
    [timedBars, levelsMap]
  );

  // 任务条几何（坐标相对时间区起点，x 单位 px）
  const barGeom = useCallback(
    (node: WorkflowNode): BarGeom => computeBarGeom(node, nodes, range, ppd),
    [nodes, range, ppd]
  );
  const pointGeom = useCallback(
    (node: WorkflowNode): PointGeom | null => computePointGeom(node, nodes, range, ppd),
    [nodes, range, ppd]
  );

  // 泳道压缩：拓扑序 + 开始日升序 → 不重叠任务共享一行（首尾衔接可共享）
  const lanes = useMemo<WorkflowNode[][]>(() => {
    const ordered = [...rows].sort((a, b) => {
      const ga = barGeom(a.node);
      const gb = barGeom(b.node);
      return a.level - b.level || ga.startDay - gb.startDay;
    });
    const map = assignLanes(
      ordered.map(({ node }) => {
        const g = barGeom(node);
        return {
          nodeId: node.id,
          startDay: g.startDay,
          endDay: g.endDay,
          prevNodeIds: node.prev_node_ids ?? [],
        };
      })
    );
    const out: WorkflowNode[][] = [];
    rows.forEach(({ node }) => {
      const li = map.get(node.id) ?? 0;
      if (!out[li]) out[li] = [];
      out[li].push(node);
    });
    return out;
  }, [rows, barGeom, ppd]);

  // 依赖连线（全局坐标）：上游右端/点状中心 → 下游左端/点状中心，y 按泳道行（点状居中 lane0）
  const timedIdSet = useMemo(() => new Set(timedNodes.map((n) => n.id)), [timedNodes]);
  const pointIdSet = useMemo(() => new Set(timedPoints.map((n) => n.id)), [timedPoints]);
  const edges = useMemo<EdgeGeom[]>(() => {
    const laneIdx = new Map<string, number>();
    lanes.forEach((lane, li) => lane.forEach((n) => laneIdx.set(n.id, li)));
    const geo = new Map(timedBars.map((n) => [n.id, barGeom(n)]));
    const pgeo = new Map(timedPoints.map((n) => [n.id, pointGeom(n)]));
    const list: EdgeGeom[] = [];
    timedNodes.forEach((n) => {
      (n.prev_node_ids ?? []).forEach((p) => {
        if (!timedIdSet.has(p)) return; // 上游无时间 → 跳过该连线
        // 上游坐标：条 → 右端；点状 → 菱形中心
        let x1: number | null = null;
        let y1 = HEADER_H + ROW_H / 2;
        if (geo.has(p)) {
          const up = geo.get(p)!;
          x1 = up.x + up.w;
          y1 = HEADER_H + (laneIdx.get(p) ?? 0) * ROW_H + ROW_H / 2;
        } else if (pgeo.has(p)) {
          x1 = pgeo.get(p)!.x;
          y1 = HEADER_H + ROW_H / 2;
        }
        // 下游坐标：条 → 左端；点状 → 菱形中心
        let x2: number | null = null;
        let y2 = HEADER_H + ROW_H / 2;
        if (geo.has(n.id)) {
          const down = geo.get(n.id)!;
          x2 = down.x;
          y2 = HEADER_H + (laneIdx.get(n.id) ?? 0) * ROW_H + ROW_H / 2;
        } else if (pgeo.has(n.id)) {
          x2 = pgeo.get(n.id)!.x;
          y2 = HEADER_H + ROW_H / 2;
        }
        if (x1 === null || x2 === null) return;
        list.push({ from: p, to: n.id, x1, y1, x2, y2 });
      });
    });
    return list;
  }, [lanes, timedNodes, timedBars, timedPoints, barGeom, pointGeom, timedIdSet]);

  const totalWidth = safeNum(range.dayCount * ppd + 24, 600);
  const totalHeight = HEADER_H + Math.max(lanes.length, 1) * ROW_H;

  // 今日线
  const dayOf = (d: Date) => Math.round((startOfDay(d).getTime() - range.rangeStart.getTime()) / DAY);
  const todayIdx = Math.max(0, Math.min(range.dayCount - 1, dayOf(today)));
  const showToday = todayIdx >= 0 && todayIdx < range.dayCount;

  // 刻度序列
  const ticks: { idx: number; label: string | null }[] = [];
  for (let i = 0; i < range.dayCount; i += 1) {
    const d = addDays(range.rangeStart, i);
    const label = range.weekly ? (d.getDay() === 1 ? fmtDay(d) : null) : fmtDay(d);
    ticks.push({ idx: i, label });
  }

  const onBarEnter = (node: WorkflowNode, geom: BarGeom, e: React.MouseEvent<HTMLElement>) => {
    setHoverId(node.id);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ node, left: rect.left, top: rect.top - 8, inverted: geom.inverted, sameAsPrev: geom.sameAsPrev });
  };
  const onPointEnter = (node: WorkflowNode, e: React.MouseEvent<HTMLElement>) => {
    setHoverId(node.id);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ node, left: rect.left, top: rect.top - 8, inverted: false, sameAsPrev: false });
  };
  const onBarLeave = () => {
    setHoverId(null);
    setTooltip(null);
  };

  const openDetail = (node: WorkflowNode) => {
    setDetailNode(node);
    setDetailOpen(true);
  };

  // 点状节点名称交替上下（同一天多个点状节点时避免压字；第 1 个在下、第 2 个在上、第 3 个在下…）
  const pointVertical = useMemo(() => {
    const byDay = new Map<string, WorkflowNode[]>();
    timedPoints.forEach((n) => {
      const key = n.point_date ?? '';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(n);
    });
    const map = new Map<string, boolean>(); // id → 在上方
    byDay.forEach((list) => {
      list.forEach((n, i) => map.set(n.id, i % 2 === 1));
    });
    return map;
  }, [timedPoints]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div ref={scrollRef} className="max-h-[calc(100vh-240px)] overflow-auto [scrollbar-gutter:stable]">
        <div className="relative" style={{ width: totalWidth, minWidth: '100%' }}>
          {/* 背景装饰：网格 + 45° 扫描纹（透明白描线，不引入新色相） */}
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.04) 1px, transparent 1px), repeating-linear-gradient(45deg, rgba(15,23,42,0.025) 0 1px, transparent 1px 24px)',
              backgroundSize: '40px 40px, 40px 40px, auto',
            }}
          />

          {/* 依赖连线（底层，避免压在任务条上方）：贝塞尔曲线 + 实心三角箭头，与流程图 panel 一致 */}
          <svg className="pointer-events-none absolute inset-0 z-0" width={totalWidth} height={totalHeight}>
            {edges.map((eg) => {
              const related = hoverId !== null && (eg.from === hoverId || eg.to === hoverId);
              const opacity = hoverId === null ? 0.22 : related ? 0.7 : 0.08;
              const cx = (eg.x1 + eg.x2) / 2;
              const d = `M ${eg.x1} ${eg.y1} C ${cx} ${eg.y1}, ${cx} ${eg.y2}, ${eg.x2} ${eg.y2}`;
              const dir = eg.x2 >= eg.x1 ? 1 : -1;
              const arrowD = `M ${eg.x2 - dir * 8} ${eg.y2 - 4.5} L ${eg.x2} ${eg.y2} L ${eg.x2 - dir * 8} ${eg.y2 + 4.5} Z`;
              return (
                <g key={`${eg.from}-${eg.to}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke="#14b8a6"
                    strokeOpacity={opacity}
                    strokeWidth={related ? 1.6 : 1.1}
                    strokeLinecap="round"
                  />
                  <path d={arrowD} fill="#14b8a6" fillOpacity={opacity} />
                </g>
              );
            })}
          </svg>

          {/* 顶部刻度（纵向滚动固定） */}
          <div
            className="sticky top-0 z-30 flex border-b border-slate-200/80 bg-[#fdfefe]/95 backdrop-blur"
            style={{ height: HEADER_H }}
          >
            <div className="relative flex flex-1">
              {ticks.map((t) => (
                <div key={t.idx} className="relative h-full shrink-0" style={{ width: ppd }}>
                  <span className="absolute inset-x-0 top-1 z-10 flex justify-center text-[10px] font-medium tabular-nums tracking-wider text-slate-400">
                    {t.label}
                  </span>
                  <span className="absolute inset-y-0 right-0 w-px bg-slate-200/60" />
                  <span className="absolute bottom-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-slate-300/70" />
                </div>
              ))}
              {/* 今天标签 */}
              {showToday && (
                <div
                  className="pointer-events-none absolute top-1 z-10 -translate-x-1/2"
                  style={{ left: todayIdx * ppd }}
                >
                  <span className="rounded-md bg-teal-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    今天
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 行内容 */}
          <div className="relative z-10">
            {/* 今日竖线（贯穿全高） */}
            {showToday && (
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-20"
                style={{ left: todayIdx * ppd }}
              >
                <span
                  className="absolute -bottom-1 -translate-x-1/2 rotate-45 border-2 border-teal-500 bg-teal-500"
                  style={{ width: 6, height: 6 }}
                />
                <span className="absolute inset-y-0 left-0 w-px bg-teal-500" />
                <span
                  className="absolute -top-1 -translate-x-1/2 rotate-45 border border-teal-500 bg-white"
                  style={{ width: 6, height: 6 }}
                />
              </div>
            )}

            {nodes.length === 0 && (
              <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-200 text-slate-400">
                <span className="text-sm">还没有任务，先回流程图添加节点吧</span>
                <Link
                  href={`/project/${project.id}`}
                  className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-600"
                >
                  前往流程图
                </Link>
              </div>
            )}
            {nodes.length > 0 && timedNodes.length === 0 && (
              <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-200 text-slate-400">
                <span className="text-sm">所有任务都还没有设定截止时间</span>
                <Link
                  href={`/project/${project.id}`}
                  className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-600"
                >
                  前往流程图设置截止时间
                </Link>
              </div>
            )}

            {/* 泳道行：每行可容纳多个时间不重叠的任务条 */}
            {lanes.map((lane, li) => (
              <div
                key={`lane-${li}`}
                className="relative border-b border-slate-100"
                style={{ height: ROW_H }}
              >
                {lane.map((node) => {
                  const geom = barGeom(node);
                  const typeColor = TYPE_COLOR[node.type] ?? TYPE_COLOR.linear;
                  const derived = deriveNodeStatus(node, nodes);
                  const overdue = derived.isOverdue;
                  const barColor = overdue ? '#f43f5e' : typeColor;
                  const gradLen = geom.w >= 200 ? 100 : geom.w * 0.5;
                  const gradPct = Math.min(100, (gradLen / Math.max(geom.w, 1)) * 100);
                  const fill = `linear-gradient(90deg, ${rgba(barColor, 0)} 0%, ${rgba(barColor, 0.85)} ${gradPct.toFixed(2)}%, ${rgba(barColor, 0.85)} 100%)`;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => openDetail(node)}
                      onMouseEnter={(e) => onBarEnter(node, geom, e)}
                      onMouseLeave={onBarLeave}
                      className="group absolute top-1/2 -translate-y-1/2 text-left hover:brightness-[1.08]"
                      style={{
                        left: geom.x,
                        width: geom.w,
                        height: ROW_H - 10,
                        zIndex: geom.inverted || geom.sameAsPrev || geom.w <= 24 ? 20 : 12,
                        boxShadow: overdue ? '0 0 10px rgba(244,63,94,0.35)' : undefined,
                      }}
                      title="点击查看详情"
                    >
                      <span
                        className="pointer-events-none absolute inset-0 rounded-[6px]"
                        style={{
                          background: fill,
                          border: `1px solid ${overdue ? 'rgba(244,63,94,0.6)' : `${barColor}40`}`,
                          borderLeft: 'none',
                          borderRight: 'transparent',
                        }}
                      />
                      <span
                        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(45deg, rgba(15,23,42,0.08) 0 1px, transparent 1px 6px)',
                        }}
                      />
                      <span
                        className="pointer-events-none absolute right-0"
                        style={{
                          top: 6,
                          bottom: 6,
                          width: 2,
                          background: overdue ? '#f43f5e' : barColor,
                          boxShadow: `0 0 8px ${rgba(barColor, 0.5)}`,
                        }}
                      />
                      {geom.inverted && (
                        <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-rose-500">
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      )}
                      <span
                        className="pointer-events-none absolute text-[11px] font-semibold leading-tight text-slate-700"
                        style={{
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: 'max-content',
                          whiteSpace: 'nowrap',
                          overflow: 'visible',
                        }}
                      >
                        {node.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            {/* 点状节点（菱形）：不占泳道，垂直居中第 0 条泳道；名称在菱形下方/上方交替 */}
            {timedPoints.length > 0 && (
              <div
                className="relative border-b border-slate-100"
                style={{ height: ROW_H }}
              >
                {timedPoints.map((node) => {
                  const geom = pointGeom(node);
                  if (!geom) return null;
                  const typeColor = TYPE_COLOR[node.type] ?? TYPE_COLOR.linear;
                  const upper = pointVertical.get(node.id) ?? false;
                  return (
                    <div key={node.id} className="absolute top-0 h-full" style={{ left: geom.x - 40, width: 80 }}>
                      <button
                        type="button"
                        onClick={() => openDetail(node)}
                        onMouseEnter={(e) => onPointEnter(node, e)}
                        onMouseLeave={onBarLeave}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-[1.15]"
                        title="点击查看详情"
                      >
                        {/* 菱形：旋转 45° 的正方形 14×14，填充类型色、白描边 2px、轻微阴影 */}
                        <span
                          className="block rotate-45"
                          style={{
                            width: 14,
                            height: 14,
                            background: typeColor,
                            border: '2px solid #fff',
                            boxShadow: '0 1px 4px rgba(15,23,42,0.28)',
                          }}
                        />
                      </button>
                      {/* 名称：10px 灰、max-w 88px 居中省略；同一天交替上下（下/上/下…） */}
                      <span
                        className={cn(
                          'pointer-events-none absolute left-1/2 w-[88px] -translate-x-1/2 truncate text-center text-[10px] text-slate-600',
                          upper ? 'top-0' : 'top-full'
                        )}
                        style={upper ? { transform: 'translateX(-50%) translateY(calc(-100% - 4px))' } : { transform: 'translateX(-50%) translateY(2px)' }}
                      >
                        {node.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 w-56 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur"
          style={{
            left: Math.min(Math.max(8, tooltip.left), window.innerWidth - 240),
            top: Math.max(8, tooltip.top),
          }}
        >
          <p className="mb-1 truncate text-xs font-bold text-slate-800">{tooltip.node.name}</p>
          <dl className="space-y-1 text-[10px]">
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-slate-400">负责人</dt>
              <dd className="text-right text-slate-700">
                {tooltip.node.assignees && tooltip.node.assignees.length > 0
                  ? tooltip.node.assignees.filter((a) => a).join('、')
                  : '未分配'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">时间</dt>
              <dd className={cn('tabular-nums text-slate-700', deriveNodeStatus(tooltip.node, nodes).isOverdue ? 'text-rose-600' : '')}>
                {tooltip.node.node_kind === 'point'
                  ? formatPointTime(tooltip.node)
                  : tooltip.node.ddl
                    ? formatDDL(tooltip.node.ddl)
                    : '未设定'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">状态</dt>
              <dd className="text-slate-700">{statusText[deriveNodeStatus(tooltip.node, nodes).status] ?? '未开始'}</dd>
            </div>
            {deriveNodeStatus(tooltip.node, nodes).isOverdue && (
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">逾期</dt>
                <dd className="text-rose-600">{deriveNodeStatus(tooltip.node, nodes).overdueLabel}</dd>
              </div>
            )}
            {tooltip.node.status === 'done' && tooltip.node.completed_at && (
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">完成</dt>
                <dd className="text-emerald-600">{formatCompletedAt(tooltip.node.completed_at)}</dd>
              </div>
            )}
            {tooltip.node.blocked_note && (
              <div className="rounded-lg bg-amber-50 px-2 py-1 text-amber-700">卡住：{tooltip.node.blocked_note}</div>
            )}
            {tooltip.node.note && (
              <div className="flex items-start gap-1 rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                <span className="line-clamp-2">备注：{tooltip.node.note}</span>
              </div>
            )}
          </dl>
          {tooltip.sameAsPrev && (
            <p className="mt-2 flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] text-sky-600">
              <Info className="h-3 w-3 shrink-0" />
              与前置任务截止时间相同
            </p>
          )}
          {tooltip.inverted && (
            <p className="mt-2 flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              前置任务结束时间晚于本任务截止时间
            </p>
          )}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailNode && (
        <NodeDetailDialog
          node={detailNode}
          nodes={nodes}
          members={members}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}