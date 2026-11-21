'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { deriveNodeStatus } from '@/lib/node-status';
import { LOCK_STATES, type LockState } from '@/lib/lock-utils';
import { toast } from 'sonner';
import {
  Lock,
  LockOpen,
  LockKeyhole,
  Users,
  CalendarRange,
  ListChecks,
  CheckCircle2,
  Loader2,
  Timer,
  Trash2,
  ArrowRight,
  Clock,
} from 'lucide-react';

interface ProjectOverviewDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 删除成功后回调（如首页刷新列表） */
  onDeleted?: () => void;
}

const LOCK_ICON: Record<LockState, React.ComponentType<{ className?: string }>> = {
  none: LockOpen,
  workflow: Lock,
  full: LockKeyhole,
};

export default function ProjectOverviewDialog({ projectId, open, onOpenChange, onDeleted }: ProjectOverviewDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<{ project: Record<string, unknown>; members: { id: string; name: string; created_at: string }[]; nodes: Record<string, any>[] } | null>(null);
  const [lockMenuOpen, setLockMenuOpen] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletePending, setDeletePending] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '加载失败');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      void fetchDetail();
      setLockMenuOpen(false);
      setConfirmDelete(false);
      setDeleteInput('');
    }
  }, [open, fetchDetail]);

  const stats = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const total = nodes.length;
    let done = 0;
    let inProgress = 0;
    let overdue = 0;
    nodes.forEach((n) => {
      const s = deriveNodeStatus(n as any, nodes as any).status;
      if (s === 'done') done += 1;
      else if (s === 'overdue') overdue += 1;
      else if (s === 'in_progress' || s === 'ready' || s === 'not_started' || s === 'blocked') inProgress += 1;
    });
    return { total, done, inProgress, overdue };
  }, [data]);

  // 时间范围：最早 DDL ～ 最晚 DDL（DDL 型 + 点状），无则 null
  const timeRange = useMemo(() => {
    const ends: number[] = [];
    (data?.nodes ?? []).forEach((n) => {
      const d = n.ddl ?? n.point_date ?? null;
      if (d) {
        const t = (n.node_kind === 'point' ? `${String(d).slice(0, 10)}T23:59:59` : new Date(d).toISOString());
        const ms = new Date(t).getTime();
        if (!Number.isNaN(ms)) ends.push(ms);
      }
    });
    if (ends.length === 0) return null;
    const min = Math.min(...ends);
    const max = Math.max(...ends);
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const pad = (x: number) => String(x).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const days = Math.round((max - min) / (24 * 3600 * 1000));
    return { min: fmt(min), max: fmt(max), days };
  }, [data]);

  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  /** 切换锁定状态 */
  async function changeLock(ls: LockState) {
    if (lockPending || !data) return;
    setLockPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_state: ls }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '更新失败');
      setData((prev) => (prev ? { ...prev, project: json.project } : prev));
      const label = LOCK_STATES.find((s) => s.value === ls)?.label ?? '';
      toast.success(ls === 'none' ? '已解锁' : ls === 'workflow' ? '已锁定工作流' : '已完全锁定', { duration: 1500 });
      void label;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败，请重试');
    } finally {
      setLockPending(false);
      setLockMenuOpen(false);
    }
  }

  /** 删除项目（输入项目名二次确认） */
  async function handleDelete() {
    if (deletePending) return;
    const name = (data?.project?.name ?? '') as string;
    if (deleteInput.trim() !== name) {
      toast.error('输入的项目名不一致', { duration: 1500 });
      return;
    }
    setDeletePending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '删除失败');
      toast.success('项目已删除', { duration: 1500 });
      onOpenChange(false);
      onDeleted?.();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试');
    } finally {
      setDeletePending(false);
    }
  }

  const lockState = (data?.project?.lock_state ?? 'none') as LockState;
  const LockIcon = LOCK_ICON[lockState];

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (deletePending || lockPending) return;
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
            {loading ? '项目总览' : (data?.project?.name as string) || '项目总览'}
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
              lockState === 'full' ? 'bg-rose-50 text-rose-600' : lockState === 'workflow' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
            )}>
              <LockIcon className="h-3 w-3" />
              {LOCK_STATES.find((s) => s.value === lockState)?.label}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            {!loading && data && (
              <>组长：{data.project.owner_name as string} · 创建于 {new Date(data.project.created_at as string).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-rose-500">{error}</div>
          ) : data ? (
            <div className="space-y-6">
              {/* 统计区（4 个小方块） */}
              <div className="grid grid-cols-4 gap-2.5">
                {[
                  { label: '节点总数', value: stats.total, cls: 'text-slate-800', icon: ListChecks, iconCls: 'text-teal-500' },
                  { label: '已完成', value: stats.done, cls: 'text-emerald-600', icon: CheckCircle2, iconCls: 'text-emerald-500' },
                  { label: '进行中', value: stats.inProgress, cls: 'text-teal-600', icon: Timer, iconCls: 'text-teal-500' },
                  { label: '已超时', value: stats.overdue, cls: 'text-rose-600', icon: Clock, iconCls: 'text-rose-500' },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 text-center">
                      <Icon className={cn('mx-auto h-4 w-4', s.iconCls)} />
                      <div className={cn('mt-1 text-xl font-bold tabular-nums', s.cls)}>{s.value}</div>
                      <div className="mt-0.5 text-[10px] font-medium text-slate-400">{s.label}</div>
                    </div>
                  );
                })}
              </div>

              {/* 进度条 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500">整体进度</span>
                  <span className="font-bold tabular-nums text-teal-600">{progress}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* 成员区（全展开） */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Users className="h-3.5 w-3.5 text-teal-500" />
                  成员（{data.members.length} 人）
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-xs text-slate-600 shadow-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-500 text-[11px] font-bold text-white">
                        {m.name.slice(0, 1).toUpperCase()}
                      </span>
                      {m.name}
                    </span>
                  ))}
                  {data.members.length === 0 && <span className="text-xs text-slate-400">暂无成员</span>}
                </div>
              </div>

              {/* 时间范围 */}
              <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
                <CalendarRange className="h-4 w-4 shrink-0 text-teal-500" />
                {timeRange ? (
                  <span>
                    最早截止 <b className="tabular-nums">{timeRange.min}</b> ～ 最晚截止 <b className="tabular-nums">{timeRange.max}</b>，共 <b className="tabular-nums">{timeRange.days}</b> 天
                  </span>
                ) : (
                  <span>还没有设定截止时间的任务</span>
                )}
              </div>

              {/* 锁定区 */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    {lockState === 'full' ? <LockKeyhole className="h-3.5 w-3.5 text-rose-500" /> : lockState === 'workflow' ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <LockOpen className="h-3.5 w-3.5 text-slate-400" />}
                    锁定设置
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      disabled={lockPending}
                      onClick={() => setLockMenuOpen((v) => !v)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-600"
                    >
                      {lockPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockIcon className="h-3.5 w-3.5" />}
                      {LOCK_STATES.find((s) => s.value === lockState)?.label}
                    </button>
                    {lockMenuOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1.5 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                        {LOCK_STATES.map((s) => {
                          const Icon = LOCK_ICON[s.value];
                          const isCurrent = s.value === lockState;
                          return (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => void changeLock(s.value)}
                              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs text-slate-600 transition hover:bg-teal-50"
                            >
                              <Icon className={cn('h-3.5 w-3.5', s.value === 'full' ? 'text-rose-500' : s.value === 'workflow' ? 'text-amber-500' : 'text-slate-400')} />
                              <span className="flex-1">{s.label}</span>
                              {isCurrent && <span className="h-2 w-2 rounded-full bg-teal-500" />}
                            </button>
                          );
                        })}
                        <div className="mt-1 border-t border-slate-100 px-3.5 pb-1 pt-2 text-[10px] leading-relaxed text-slate-400">
                          {LOCK_STATES.find((s) => s.value === lockState)?.desc}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  锁定工作流：任务结构（增删改、前置、时间、备注）冻结，成员与状态仍可修改；完全锁定：所有修改冻结。
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* 底部：进入项目 / 删除 */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              router.push(`/project/${projectId}`);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-200 transition hover:bg-teal-600 active:scale-[0.99]"
          >
            进入项目
            <ArrowRight className="h-4 w-4" />
          </button>
          {confirmDelete ? (
            <div className="ml-auto flex items-center gap-2">
              <input
                autoFocus
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setConfirmDelete(false);
                    setDeleteInput('');
                  }
                }}
                placeholder={`输入「${data?.project?.name ?? ''}」确认删除`}
                className="h-9 w-44 rounded-lg border border-rose-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
              />
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deletePending}
                className="flex h-9 items-center gap-1 rounded-lg bg-rose-500 px-3 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
              >
                {deletePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                确认删除
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteInput('');
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-rose-500 transition hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除项目
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}