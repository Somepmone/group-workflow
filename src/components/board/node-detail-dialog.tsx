'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WorkflowNode, Member } from '@/lib/types';
import { NODE_TYPES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCompletedAt, formatDDL, formatPointTime } from '@/lib/client-utils';
import { deriveNodeStatus } from '@/lib/node-status';
import { CalendarClock, AlertTriangle, User, GitMerge, GitBranch, StickyNote, Check, Loader2, X, MessageSquare } from 'lucide-react';
import { CommentBody } from '@/components/comment-panel';
import { getLocalNickname } from '@/lib/client-utils';

interface NodeDetailDialogProps {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
}

const typeInfo: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  linear: { label: '普通', icon: <GitBranch className="h-4 w-4" />, cls: 'bg-sky-50 text-sky-600' },
  converge: { label: '汇聚', icon: <GitMerge className="h-4 w-4" />, cls: 'bg-amber-50 text-amber-600' },
};

const stateBadge: Record<string, { label: string; cls: string }> = {
  not_started: { label: '未开始', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  in_progress: { label: '进行中', cls: 'bg-teal-50 text-teal-600 border-teal-200' },
  ready: { label: '可进行', cls: 'bg-teal-100/60 text-teal-700 border-teal-300' },
  overdue: { label: '已超时', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  done: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  blocked: { label: '卡住了', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
};

/** 节点详情弹窗：展示所有字段 + 状态操作（标记完成 / 标记卡住了 / 取消标记） */
export default function NodeDetailDialog({ node, nodes, members, open, onOpenChange, onUpdate }: NodeDetailDialogProps) {
  const [updating, setUpdating] = useState(false);
  const [blockedEditorOpen, setBlockedEditorOpen] = useState(false);
  const [blockedText, setBlockedText] = useState(node.blocked_note ?? '');
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const derived = deriveNodeStatus(node, nodes);
  const assignees = node.assignees && node.assignees.length > 0 ? node.assignees : (node.assignee ? [node.assignee] : []);
  const memberNames = new Set(members.map((m) => m.name));

  // 通知自动刷新 hook：弹窗打开期间暂停刷新，关闭后恢复并立即刷新一次
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wf:editing', { detail: open }));
  }, [open]);

  useEffect(() => {
    setBlockedText(node.blocked_note ?? '');
    setBlockedError(null);
    setBlockedEditorOpen(false);
  }, [node.id, node.blocked_note]);

  async function run(action: 'done' | 'blocked' | 'todo', note?: string) {
    setUpdating(true);
    setBlockedError(null);
    try {
      if (action === 'blocked') {
        const text = (note ?? blockedText).trim();
        if (text.length < 2) {
          setBlockedError('请填写卡住说明（至少 2 个字）');
          return;
        }
        await onUpdate(node.id, { status: 'blocked', blocked_note: text });
        setBlockedEditorOpen(false);
      } else if (action === 'done') {
        await onUpdate(node.id, { status: 'done' });
      } else {
        await onUpdate(node.id, { status: 'todo' });
      }
    } finally {
      setUpdating(false);
    }
  }

  const type = typeInfo[node.type] ?? typeInfo.linear;
  const badge = stateBadge[derived.status] ?? stateBadge.not_started;
  const isPoint = node.node_kind === 'point';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-start justify-between gap-2 pr-6">
            <span className="min-w-0 flex-1 break-words text-lg leading-snug">{node.name}</span>
            <span className={cn('mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold', badge.cls)}>
              {badge.label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 标签行 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', type.cls)}>
              {type.icon}
              {type.label}
            </span>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', isPoint ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500')}>
              {isPoint ? '点状' : 'DDL 型'}
            </span>
            {derived.isOverdue && (
              <span className="flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="h-3 w-3" />
                {derived.overdueLabel}
              </span>
            )}
            {derived.status === 'done' && node.completed_at && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                <Check className="h-3 w-3" />
                {formatCompletedAt(node.completed_at)} 完成
              </span>
            )}
          </div>

          {/* 信息列表 */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <User className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="w-16 shrink-0 text-xs text-slate-400">负责人</span>
              <span className="flex flex-wrap gap-1 text-sm font-medium text-slate-700">
                {assignees.length > 0 ? (
                  assignees.map((a) => (
                    <span key={a} className="rounded-md bg-white px-1.5 py-0.5 text-xs ring-1 ring-slate-200">
                      {a}
                      {!memberNames.has(a) && <span className="text-[9px] text-slate-400">（未加入）</span>}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">未分配</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="w-16 shrink-0 text-xs text-slate-400">{isPoint ? '日期' : 'DDL'}</span>
              <span className={cn('text-sm font-medium', derived.isOverdue ? 'text-rose-600' : 'text-slate-700')}>
                {isPoint ? (formatPointTime(node) || '未设置') : (formatDDL(node.ddl) || '未设置')}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-xs text-slate-400">前置节点</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {node.prev_node_ids && node.prev_node_ids.length > 0 ? (
                  node.prev_node_ids.map((pid) => {
                    const prevDef = pid === '__none__' ? null : nodes.find((n) => n.id === pid);
                    return (
                      <span key={pid} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">
                        {prevDef?.name ?? '（已删除）'}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-xs text-slate-400">无（起始节点）</span>
                )}
              </div>
            </div>
            {node.blocked_note && (
              <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
                <span className="text-xs font-medium text-amber-600">卡住说明</span>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-700">{node.blocked_note}</p>
              </div>
            )}
            {node.note && (
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <span className="text-xs text-slate-400">备注</span>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{node.note}</p>
                </div>
              </div>
            )}
          </div>

          {/* 状态操作 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">标记状态</p>
            <div className="flex flex-wrap items-center gap-2">
              {node.status !== 'done' && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => run('done')}
                  className="flex items-center gap-1.5 rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  标记完成
                </button>
              )}
              {node.status !== 'blocked' && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => setBlockedEditorOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-600 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  标记卡住了
                </button>
              )}
              {(node.status === 'done' || node.status === 'blocked') && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => run('todo')}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  取消标记
                </button>
              )}
            </div>

            {blockedEditorOpen && node.status !== 'blocked' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <textarea
                  autoFocus
                  value={blockedText}
                  onChange={(e) => {
                    setBlockedText(e.target.value);
                    if (e.target.value.trim().length >= 2) setBlockedError(null);
                  }}
                  rows={2}
                  placeholder="说明卡在哪里，比如：等学委签字、资料没齐…"
                  className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                />
                {blockedError && (
                  <p className="mt-1 text-[11px] font-medium text-rose-500">{blockedError}</p>
                )}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBlockedEditorOpen(false);
                      setBlockedError(null);
                      setBlockedText(node.blocked_note ?? '');
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={updating || blockedText.trim().length < 2}
                    onClick={() => run('blocked')}
                    className="flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
                  >
                    {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    提交
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 评论区：内嵌展示 + 输入（不重复弹窗） */}
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <MessageSquare className="h-4 w-4 text-slate-400" />
              评论与求助
            </p>
            <CommentBody nodeId={node.id} myName={getLocalNickname()} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}