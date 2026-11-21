'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowNode, Member, NodeType } from '@/lib/types';
import { DERIVED_STATUS_COLOR, DERIVED_STATUSES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatDDL, formatPointTime } from '@/lib/client-utils';
import { deriveNodeStatus } from '@/lib/node-status';
import { computeWorkflowLabels } from '@/lib/workflow-labels';
import { orderByBarycenter } from '@/lib/barycenter-layout';

interface FlowCanvasProps {
  nodes: WorkflowNode[];
  members: Member[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** 最小高度，默认 280 */
  minHeight?: number;
}

const typeColorMap: Record<NodeType, { bg: string; border: string; text: string; dot: string }> = {
  linear: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', dot: 'bg-sky-500' },
  converge: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' },
};

const typeLabels: Record<NodeType, string> = {
  linear: '普通',
  converge: '汇聚',
};

interface Edge {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * 流程图：按 DAG 依赖布局。
 * - 层级 layer：无前置=0，其他=max(前置 layer)+1
 * - 同一 layer 的节点垂直并排，不同 layer 从左到右
 * - SVG 贝塞尔曲线：分叉点右侧分叉多条线，多个前置左侧汇聚
 * - 支持横向滚动，节点多时不挤压
 */
export default function FlowCanvas({ nodes, members, selectedId, onSelect, minHeight = 280 }: FlowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [edges, setEdges] = useState<Edge[]>([]);

  const memberNames = useMemo(() => new Set(members.map((m) => m.name)), [members]);
  void memberNames;
  const labels = useMemo(() => computeWorkflowLabels(nodes), [nodes]);
  const validIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  // 按层级分组，同层节点用重心法排序减少箭头交叉
  const columns = useMemo(() => {
    const ordered = orderByBarycenter(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return ordered.map((ids) => ids.map((id) => byId.get(id)).filter((n): n is WorkflowNode => Boolean(n)));
  }, [nodes]);

  // 绘制依赖箭头（分叉/汇聚锚点错开，避免重叠成一条线）
  useEffect(() => {
    function draw() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const list: Edge[] = [];

      nodes.forEach((node) => {
        const toEl = nodeRefs.current.get(node.id);
        if (!toEl) return;
        const prevs = (node.prev_node_ids || []).filter((p) => validIds.has(p));
        const inCount = prevs.length;
        prevs.forEach((prevId, i) => {
          const fromEl = nodeRefs.current.get(prevId);
          if (!fromEl) return;
          // 该源节点的全部后继（出边），确定本边在出边的第几个
          const siblings = nodes.filter((n) => (n.prev_node_ids || []).includes(prevId) && validIds.has(prevId));
          const outCount = Math.max(siblings.length, 1);
          const outIdx = Math.max(siblings.findIndex((s) => s.id === node.id), 0);
          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();
          const spread = 18; // 相邻锚点垂直间隔
          // 出边锚点：源节点右侧按出边序号上下散布（体现分叉）
          const fromY = fromRect.top + fromRect.height / 2 + (outIdx - (outCount - 1) / 2) * spread;
          // 入边锚点：目标节点左侧按入边序号上下散布（体现汇聚）
          const toY = toRect.top + toRect.height / 2 + (i - (inCount - 1) / 2) * spread;
          list.push({
            from: { x: fromRect.right - rect.left, y: fromY - rect.top },
            to: { x: toRect.left - rect.left, y: toY - rect.top },
          });
        });
      });
      setEdges(list);
    }

    draw();
    const t = window.setTimeout(draw, 200);
    window.addEventListener('resize', draw);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', draw);
    };
  }, [nodes, columns, validIds]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-400">
        还没有节点，在左侧添加一个吧
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-slate-50 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-700">工作流</h3>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" /> 普通</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" /> 汇聚</span>
          <span className="ml-1 text-slate-300">|</span>
          <span>← 分叉 / 汇聚 →</span>
        </div>
      </div>
      <div ref={containerRef} className="relative px-6 py-6" style={{ minHeight }}>
        {/* 依赖箭头 */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {edges.map((e, i) => {
            const cx = (e.from.x + e.to.x) / 2;
            const path = `M ${e.from.x} ${e.from.y} C ${cx} ${e.from.y}, ${cx} ${e.to.y}, ${e.to.x} ${e.to.y}`;
            return (
              <g key={i}>
                <path d={path} fill="none" stroke="#cbd5e1" strokeWidth="2" />
                <path
                  d={path}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.2"
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  opacity="0.55"
                />
                {/* 箭头头部 */}
                <path
                  d={`M ${e.to.x - 2} ${e.to.y - 5} L ${e.to.x + 5} ${e.to.y} L ${e.to.x - 2} ${e.to.y + 5}`}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.7"
                />
              </g>
            );
          })}
        </svg>

        {/* 节点列：同一 layer 垂直并排，不同 layer 从左到右 */}
        <div className="flex w-max items-start gap-14">
          {columns.map((col, colIndex) => (
            <div key={colIndex} className="flex w-48 shrink-0 flex-col items-center justify-center gap-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">第 {colIndex + 1} 层</div>
              {col.map((node) => {
                const color = typeColorMap[node.type];
                const derived = deriveNodeStatus(node, nodes);
                const overdue = derived.isOverdue;
                const statusColor = DERIVED_STATUS_COLOR[derived.status];
                const statusLabel = DERIVED_STATUSES.find((s) => s.value === derived.status)?.label ?? '未开始';
                const assignees = node.assignees && node.assignees.length > 0 ? node.assignees : (node.assignee ? [node.assignee] : []);
                const label = labels.get(node.id) ?? '';
                return (
                  <div
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(node.id, el);
                      else nodeRefs.current.delete(node.id);
                    }}
                    onClick={() => onSelect(node.id)}
                    className={cn(
                      'w-full cursor-pointer rounded-xl border-2 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                      color.bg,
                      color.border,
                      selectedId === node.id && 'ring-2 ring-teal-400 ring-offset-1',
                      overdue && 'border-rose-400'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-md bg-white/80 px-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                          {label || '-'}
                        </span>
                        <span className={cn('text-[11px] font-bold', color.text)}>{typeLabels[node.type]}</span>
                      </span>
                      <span
                        className={cn('h-2 w-2 rounded-full', statusColor.dot)}
                        title={statusLabel}
                      />
                    </div>
                    <div className="mt-1.5 break-words text-[13px] font-semibold leading-snug text-slate-700">
                      {node.name}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px]">
                      <span className="truncate text-slate-400">
                        {assignees.length > 0
                          ? `${assignees[0]}${assignees.length > 1 ? ` +${assignees.length - 1}` : ''}`
                          : '待分配'}
                      </span>
                      {(node.node_kind === 'point' ? node.point_date : node.ddl) && (
                        <span className="shrink-0 text-slate-400">
                          {node.node_kind === 'point' ? formatPointTime(node) : formatDDL(node.ddl)}
                        </span>
                      )}
                    </div>
                    {overdue && (
                      <div className="mt-1 truncate text-[10px] font-medium text-rose-500">{derived.overdueLabel}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}