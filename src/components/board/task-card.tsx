'use client';

import { useState } from 'react';
import type { WorkflowNode, NodeStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatDDL, formatPointTime } from '@/lib/client-utils';
import { deriveNodeStatus } from '@/lib/node-status';
import { AlertTriangle, User, CalendarClock, Check, ChevronsUpDown, Loader2, StickyNote, CircleAlert, MessageSquare, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface TaskCardProps {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  onClick: () => void;
  onStatusChange?: (nodeId: string, patch: { status: NodeStatus; blocked_note?: string }) => void | Promise<void>;
  /** 评论计数（看板聚合拉取） */
  commentCount?: number;
  helpCount?: number;
  /** 点击评论按钮（stopPropagation 后打开评论面板，不打开详情弹窗） */
  onOpenComments?: () => void;
}

const typeClassMap: Record<string, string> = {
  linear: 'bg-sky-500',
  converge: 'bg-amber-500',
};

/** 派生状态徽章样式 */
const statusBadgeCls: Record<string, string> = {
  not_started: 'border-slate-200 bg-slate-50 text-slate-500',
  in_progress: 'border-teal-200 bg-teal-50 text-teal-600',
  ready: 'border-teal-300 bg-teal-100/50 text-teal-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-600',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  blocked: 'border-amber-200 bg-amber-50 text-amber-600',
};

const statusLabel: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  ready: '可进行',
  overdue: '已超时',
  done: '已完成',
  blocked: '卡住了',
};

/** 看板任务卡片：派生状态标签 + 多负责人 + 备注；右下角状态操作弹出（标记完成 / 卡住了 / 取消标记）+ 评论按钮 */
export default function TaskCard({ node, nodes, onClick, onStatusChange, commentCount = 0, helpCount = 0, onOpenComments }: TaskCardProps) {
  const derived = deriveNodeStatus(node, nodes);
  const [statusOpen, setStatusOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedText, setBlockedText] = useState('');
  const [blockedError, setBlockedError] = useState<string | null>(null);

  const assignees = node.assignees && node.assignees.length > 0 ? node.assignees : (node.assignee ? [node.assignee] : []);
  const assigneePreview = assignees.slice(0, 3);
  const isPoint = node.node_kind === 'point';

  async function pick(patch: { status: NodeStatus; blocked_note?: string }) {
    if (pending || !onStatusChange) return;
    if (patch.status === node.status && patch.status !== 'blocked') return;
    setPending(true);
    try {
      await onStatusChange(node.id, patch);
      toast.success(`已更新为「${statusLabel[patch.status] ?? patch.status}」`, { duration: 1500 });
      setStatusOpen(false);
      setBlockedOpen(false);
      setBlockedText('');
      setBlockedError(null);
    } catch {
      toast.error('状态修改失败，请重试', { duration: 2000 });
    } finally {
      setPending(false);
    }
  }

  function submitBlocked() {
    const text = blockedText.trim();
    if (text.length < 2) {
      setBlockedError('请填写卡住说明（至少 2 个字）');
      return;
    }
    void pick({ status: 'blocked', blocked_note: text });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group w-full cursor-pointer rounded-xl border bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        derived.status === 'blocked' && 'border-l-4 border-l-amber-400',
        derived.status === 'overdue' ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100'
      )}
    >
      {/* 头部：类型条 + 状态缩影 */}
      <div className="flex items-center justify-between">
        <span className={cn('h-1.5 w-8 rounded-full', typeClassMap[node.type] ?? 'bg-slate-300')} />
        {derived.status === 'overdue' && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-rose-500">
            <AlertTriangle className="h-3 w-3" />
            {derived.overdueLabel}
          </span>
        )}
      </div>

      {/* 名称 */}
      <div className="mt-2 break-words text-sm font-semibold leading-snug text-slate-700">{node.name}</div>

      {/* 元信息：负责人（最多 3 个 +N） */}
      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <User className="h-3 w-3 shrink-0" />
          {assigneePreview.length > 0 ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-1">
              <span className="truncate text-slate-500">{assigneePreview.join('、')}</span>
              {assignees.length > 3 && <span className="shrink-0 text-slate-400">+{assignees.length - 3}</span>}
            </span>
          ) : (
            <span className="text-slate-300">待分配</span>
          )}
        </div>
        {(node.ddl || isPoint) && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <CalendarClock className={cn('h-3 w-3 shrink-0', derived.isOverdue ? 'text-rose-500' : 'text-slate-300')} />
            <span className={cn(derived.isOverdue ? 'font-semibold text-rose-500' : 'text-slate-400')}>
              {isPoint ? (formatPointTime(node) || '未设置') : (formatDDL(node.ddl) || '未设置')}
            </span>
          </div>
        )}
        {node.note && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <StickyNote className="h-3 w-3 shrink-0 text-slate-300" />
            <span className="truncate">{node.note}</span>
          </div>
        )}
        {derived.status === 'blocked' && node.blocked_note && (
          <div className="-mx-0.5 mt-1 max-w-full overflow-hidden rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-700">
            <span className="line-clamp-2">{node.blocked_note}</span>
          </div>
        )}
        {derived.status === 'done' && node.completed_at && (
          <div className="flex items-center gap-1 text-[11px] text-emerald-600">
            <Check className="h-3 w-3 shrink-0" />
            {formatCompletedAtShort(node.completed_at)} 完成
          </div>
        )}
      </div>

      {/* 右下角：评论按钮（stopPropagation，打开面板不触发详情）+ 状态操作 */}
      <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-slate-100/80 pt-2">
        {onOpenComments && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenComments();
            }}
            title="评论与求助"
            aria-label="评论与求助"
            className="flex h-8 min-w-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 transition hover:border-teal-300 hover:text-teal-600"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {commentCount > 0 && <span className="tabular-nums">{commentCount}</span>}
            {helpCount > 0 && (
              <span className="flex items-center gap-0.5 rounded bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                <LifeBuoy className="h-2.5 w-2.5" />
                求助 {helpCount}
              </span>
            )}
          </button>
        )}
        <Popover
          open={statusOpen}
          onOpenChange={(v) => {
            setStatusOpen(v);
            if (!v) {
              setBlockedOpen(false);
              setBlockedText('');
              setBlockedError(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              disabled={pending}
              aria-label="切换任务状态"
              className={cn(
                'flex h-8 min-w-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition',
                statusBadgeCls[derived.status],
                pending && 'opacity-60'
              )}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  {deriveStatusText(node, nodes)}
                  <ChevronsUpDown className="h-3 w-3 opacity-70" />
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-48 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">标记状态</p>
            {node.status !== 'done' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void pick({ status: 'done' });
                }}
                disabled={pending}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                标记完成
              </button>
            )}
            {node.status !== 'blocked' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setBlockedOpen((v) => !v);
                  setBlockedError(null);
                }}
                disabled={pending}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
              >
                <CircleAlert className="h-3.5 w-3.5" />
                标记卡住了…
              </button>
            )}
            {blockedOpen && node.status !== 'blocked' && (
              <div className="px-1 pb-1">
                <textarea
                  autoFocus
                  value={blockedText}
                  onChange={(e) => {
                    setBlockedText(e.target.value);
                    if (e.target.value.trim().length >= 2) setBlockedError(null);
                  }}
                  rows={2}
                  placeholder="说明卡在哪里（至少 2 个字）"
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
                {blockedError && <p className="mt-1 text-[10px] font-medium text-rose-500">{blockedError}</p>}
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBlockedOpen(false)}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={pending || blockedText.trim().length < 2}
                    onClick={(e) => {
                      e.stopPropagation();
                      submitBlocked();
                    }}
                    className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : '提交'}
                  </button>
                </div>
              </div>
            )}
            {(node.status === 'done' || node.status === 'blocked') && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void pick({ status: 'todo' });
                }}
                disabled={pending}
                className="mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2.5 py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
              >
                取消标记
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** 卡片状态标签文案：已超时带小时数 */
function deriveStatusText(node: WorkflowNode, nodes: WorkflowNode[]): string {
  const d = deriveNodeStatus(node, nodes);
  if (d.status === 'overdue') return d.overdueLabel ?? '已超时';
  return statusLabel[d.status] ?? '未开始';
}

function formatCompletedAtShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}