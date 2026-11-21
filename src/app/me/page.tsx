'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { MyNodeItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getLocalNickname, saveLocalNickname } from '@/lib/client-utils';
import CommentPanel from '@/components/comment-panel';
import ProjectOverviewDialog from '@/components/project-overview-dialog';
import { toast } from 'sonner';
import {
  Workflow,
  ChevronLeft,
  User,
  MessageSquare,
  LifeBuoy,
  Check,
  CircleAlert,
  Loader2,
  ChevronDown,
  Clock,
} from 'lucide-react';

type FilterKey = 'all' | 'overdue' | 'in_progress' | 'not_started' | 'done';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'overdue', label: '已超时' },
  { key: 'in_progress', label: '进行中' },
  { key: 'not_started', label: '未开始' },
  { key: 'done', label: '已完成' },
];

const STATUS_BADGE: Record<string, string> = {
  not_started: 'border-slate-200 bg-slate-50 text-slate-500',
  in_progress: 'border-teal-200 bg-teal-50 text-teal-600',
  ready: 'border-teal-200 bg-teal-50/70 text-teal-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-600',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  blocked: 'border-amber-200 bg-amber-50 text-amber-600',
};

const STATUS_TEXT: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  ready: '可进行',
  overdue: '已超时',
  done: '已完成',
  blocked: '卡住了',
};

/** 区块头部右侧状态徽章（只显示非零项） */
const BADGE_META: { key: 'overdue' | 'in_progress' | 'not_started' | 'done'; label: string; cls: string }[] = [
  { key: 'overdue', label: '已超时', cls: 'bg-rose-50 text-rose-600 border-rose-100' },
  { key: 'in_progress', label: '进行中', cls: 'bg-teal-50 text-teal-600 border-teal-100' },
  { key: 'not_started', label: '未开始', cls: 'bg-slate-50 text-slate-500 border-slate-100' },
  { key: 'done', label: '已完成', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
];

/* ---------- 纯工具 ---------- */

/** ISO → 本地日期 'YYYY-MM-DD' */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 任务到期日 'YYYY-MM-DD'（无时间为空串） */
function dueDay(n: MyNodeItem): string {
  if (n.nodeKind === 'point' && n.pointDate) return String(n.pointDate).slice(0, 10);
  if (n.ddl) {
    const d = new Date(n.ddl);
    if (!Number.isNaN(d.getTime())) return localDay(n.ddl);
  }
  return '';
}

/** 任务到期时刻 ms（无时间 → Infinity） */
function dueMs(n: MyNodeItem): number {
  if (n.nodeKind === 'point' && n.pointDate) {
    return new Date(`${String(n.pointDate).slice(0, 10)}T23:59:59`).getTime();
  }
  if (n.ddl) {
    const t = new Date(n.ddl).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return Infinity;
}

/** 卡片上方日期展示：11-23 18:00 / 11-23 全天 / 11-23 14:00-16:00 */
function formatWhen(n: MyNodeItem): string {
  const day = dueDay(n);
  if (!day) return '';
  const [, m, d] = day.split('-').map(Number);
  const prefix = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (n.nodeKind === 'point') {
    if (!n.pointAllDay && n.pointStartTime && n.pointEndTime) return `${prefix} ${n.pointStartTime}-${n.pointEndTime}`;
    return `${prefix} 全天`;
  }
  const dt = new Date(n.ddl as string);
  if (!Number.isNaN(dt.getTime())) {
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${prefix} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  return prefix;
}

/** 展开列表排序优先级：已超时 → 可进行 → 进行中 → 未开始 → 卡住了（卡住了放最后突出说明） */
function listRank(n: MyNodeItem): number {
  switch (n.derivedStatus) {
    case 'overdue':
      return 0;
    case 'ready':
      return 1;
    case 'in_progress':
      return 2;
    case 'not_started':
      return 3;
    default:
      return 4;
  }
}

/** 筛选：进行中 = in_progress + ready */
function matchFilter(n: MyNodeItem, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'overdue') return n.derivedStatus === 'overdue';
  if (filter === 'in_progress') return n.derivedStatus === 'in_progress' || n.derivedStatus === 'ready';
  if (filter === 'not_started') return n.derivedStatus === 'not_started';
  if (filter === 'done') return n.derivedStatus === 'done';
  return true;
}

/* ---------- 昵称门槛（/me 无项目上下文，纯本地身份） ---------- */

function useNickname(): [string | null, (name: string) => void] {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const cached = getLocalNickname();
    if (cached) setName(cached);
  }, []);
  const save = useCallback((n: string) => {
    const t = n.trim();
    if (!t) return;
    saveLocalNickname(t);
    setName(t);
  }, []);
  return [name, save];
}

/* ---------- 页面 ---------- */

interface ProjectBlock {
  projectId: string;
  projectName: string;
  active: MyNodeItem[];
  done: MyNodeItem[];
  earliestDue: number;
}

export default function MePage() {
  const [name, saveName] = useNickname();
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MyNodeItem[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  // 项目区块折叠（默认全展开）；已完成列表折叠（默认折叠）
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [doneCollapsed, setDoneCollapsed] = useState<Record<string, boolean>>({});
  const [commentNode, setCommentNode] = useState<MyNodeItem | null>(null);
  const [overviewId, setOverviewId] = useState<string | null>(null);
  // 状态操作展开（blocked 输入）
  const [blockedFor, setBlockedFor] = useState<string | null>(null);
  const [blockedText, setBlockedText] = useState('');
  const [blockedError, setBlockedError] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const fetchTasks = useCallback(async (n: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/me/nodes?name=${encodeURIComponent(n)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setItems(data.nodes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (name) void fetchTasks(name);
  }, [name, fetchTasks]);

  /** 顶部统计：参与项目 / 待办（status !== done）/ 已超时 */
  const stats = useMemo(() => {
    const list = items ?? [];
    return {
      projects: new Set(list.map((n) => n.projectId)).size,
      todo: list.filter((n) => n.status !== 'done').length,
      overdue: list.filter((n) => n.derivedStatus === 'overdue').length,
    };
  }, [items]);

  /** 按项目分组 + 排序 */
  const projectBlocks = useMemo<ProjectBlock[]>(() => {
    const list = items ?? [];
    const map = new Map<string, ProjectBlock>();
    list.forEach((n) => {
      if (!matchFilter(n, filter)) return;
      const block = map.get(n.projectId) ?? { projectId: n.projectId, projectName: n.projectName, active: [], done: [], earliestDue: Infinity };
      if (n.derivedStatus === 'done') block.done.push(n);
      else block.active.push(n);
      block.earliestDue = Math.min(block.earliestDue, dueMs(n));
      map.set(n.projectId, block);
    });
    const blocks = [...map.values()];
    blocks.forEach((b) => {
      b.active.sort((a, b) => listRank(a) - listRank(b) || dueMs(a) - dueMs(b));
      b.done.sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
    });
    // 项目区块排序：最早 DDL 升序，无 DDL 排最后
    blocks.sort((a, b) => (a.earliestDue === Infinity ? 1 : b.earliestDue === Infinity ? -1 : a.earliestDue - b.earliestDue));
    return blocks;
  }, [items, filter]);

  /** 区块状态徽章计数（只显示非零） */
  const blockBadges = useMemo(() => {
    const out: Record<string, { key: (typeof BADGE_META)[number]['key']; label: string; cls: string; count: number }[]> = {};
    projectBlocks.forEach((b) => {
      const counters: Record<string, number> = { overdue: 0, in_progress: 0, not_started: 0, done: 0 };
      [...b.active, ...b.done].forEach((n) => {
        if (n.derivedStatus === 'overdue') counters.overdue += 1;
        else if (n.derivedStatus === 'in_progress' || n.derivedStatus === 'ready') counters.in_progress += 1;
        else if (n.derivedStatus === 'not_started') counters.not_started += 1;
        else if (n.derivedStatus === 'done') counters.done += 1;
      });
      out[b.projectId] = BADGE_META.map((m) => ({ ...m, count: counters[m.key] })).filter((x) => x.count > 0);
    });
    return out;
  }, [projectBlocks]);

  /** 状态操作：PATCH 后本地更新该节点 */
  async function patchItem(nodeId: string, patch: { status: string; blocked_note?: string }) {
    if (pending) return;
    setPending(nodeId);
    try {
      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');
      const updated = data.node as Record<string, unknown>;
      setItems((prev) =>
        (prev ?? []).map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            status: updated.status as MyNodeItem['status'],
            blockedNote: (updated.blocked_note ?? null) as string | null,
            completedAt: (updated.completed_at ?? null) as string | null,
            derivedStatus: updated.status === 'done' ? 'done' : updated.status === 'blocked' ? 'blocked' : n.derivedStatus,
          };
        })
      );
      setBlockedFor(null);
      setBlockedText('');
      setBlockedError('');
      toast.success('已更新', { duration: 1500 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '状态修改失败，请重试');
    } finally {
      setPending(null);
    }
  }

  /** 评论提交后刷新计数 */
  const refreshCounts = useCallback(() => {
    if (name) void fetchTasks(name);
  }, [name, fetchTasks]);

  const hasAnyTask = (items ?? []).length > 0;
  const hasFiltered = projectBlocks.length > 0;

  /** 项目区块折叠切换 */
  function toggleProject(pid: string) {
    setCollapsedProjects((v) => ({ ...v, [pid]: !v[pid] }));
  }
  function toggleDone(pid: string) {
    setDoneCollapsed((v) => ({ ...v, [pid]: !v[pid] }));
  }

  // 昵称门槛
  if (!name) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-teal-50/60 to-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-xl shadow-slate-200/60">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500 shadow-lg shadow-teal-200">
            <User className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-5 text-center text-lg font-bold text-slate-800">我的任务</h2>
          <p className="mt-1.5 text-center text-xs text-slate-400">输入昵称，查看你负责的所有任务</p>
          <div className="mt-6 space-y-2">
            <input
              value={nicknameInput}
              onChange={(e) => {
                setNicknameInput(e.target.value);
                if (e.target.value.trim()) setNicknameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const t = nicknameInput.trim();
                  if (!t) setNicknameError('请输入昵称');
                  else saveName(t);
                }
              }}
              placeholder="你的昵称"
              maxLength={20}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            {nicknameError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{nicknameError}</p>}
            <button
              type="button"
              onClick={() => {
                const t = nicknameInput.trim();
                if (!t) {
                  setNicknameError('请输入昵称');
                  return;
                }
                saveName(t);
              }}
              className="mt-1 w-full rounded-xl bg-teal-500 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-200 transition hover:bg-teal-600 active:scale-[0.99]"
            >
              查看我的任务
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8f8]">
      {/* 顶部装饰条 */}
      <div className="h-1.5 w-full bg-gradient-to-r from-teal-500 via-cyan-500 to-teal-400" />

      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* 面包屑 */}
        <div className="mb-5 flex items-center gap-1 text-xs text-slate-400">
          <Link href="/" className="flex items-center gap-0.5 hover:text-slate-600">
            <ChevronLeft className="h-3 w-3" />
            首页
          </Link>
          <span>/</span>
          <span className="text-slate-500">我的任务</span>
        </div>

        <Link href="/" className="mb-4 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:border-teal-300 hover:text-teal-600">
          <Workflow className="h-3.5 w-3.5" />
          回到首页
        </Link>

        {/* 顶部区：标题 + 统计 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">{name} 的任务</h1>
            <p className="mt-1 text-xs text-slate-400">参与 {stats.projects} 个项目 · 待办 {stats.todo} 个 · 已超时 {stats.overdue} 个</p>
          </div>
          <div className="flex gap-2">
            {[
              { label: '参与项目', value: stats.projects, activeCls: 'bg-teal-50 text-teal-600 border-teal-200' },
              { label: '待办任务', value: stats.todo, activeCls: 'bg-slate-50 text-slate-700 border-slate-200' },
              { label: '已超时', value: stats.overdue, activeCls: 'bg-rose-50 text-rose-600 border-rose-200' },
            ].map((s) => (
              <div
                key={s.label}
                className={cn(
                  'flex min-w-16 flex-col items-center rounded-xl border bg-white px-4 py-2.5 shadow-sm',
                  s.value === 0 ? 'text-slate-300 border-slate-100' : s.activeCls
                )}
              >
                <span className="text-xl font-bold tabular-nums">{s.value}</span>
                <span className="text-[10px] font-medium opacity-80">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 筛选 Tab */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-semibold transition',
                filter === f.key ? 'bg-teal-500 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-500 hover:border-teal-300 hover:text-teal-600'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 加载 / 错误 / 空态 */}
        {loading && items === null ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error && (items ?? []).length === 0 ? (
          <div className="py-24 text-center text-sm text-rose-500">{error}</div>
        ) : !hasAnyTask ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center">
            <Check className="h-8 w-8 text-slate-200" />
            <p className="text-sm font-medium text-slate-500">你还没有被分配到任何任务</p>
            <p className="max-w-xs text-xs text-slate-400">去项目里看看，被指派为负责人后就会出现在这里</p>
            <Link href="/" className="mt-2 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-teal-200 transition hover:bg-teal-600">
              去项目里看看
            </Link>
          </div>
        ) : !hasFiltered ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center">
            <Check className="h-8 w-8 text-slate-200" />
            <p className="text-sm font-medium text-slate-500">没有符合条件的任务</p>
            <button type="button" onClick={() => setFilter('all')} className="mt-2 rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-teal-200 transition hover:bg-teal-600">
              查看全部
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {projectBlocks.map((block) => {
              const collapsed = !!collapsedProjects[block.projectId];
              const doneCollapsedP = doneCollapsed[block.projectId] !== false;
              const badges = blockBadges[block.projectId] ?? [];
              return (
                <section key={block.projectId} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                  {/* 区块头部 */}
                  <div className="flex items-center gap-1.5 border-b border-slate-100/80 px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleProject(block.projectId)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      title={collapsed ? '展开该项目' : '折叠该项目'}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewId(block.projectId)}
                      className="min-w-0 truncate text-left text-sm font-bold text-slate-700 transition hover:text-teal-600"
                      title={`打开「${block.projectName}」总览`}
                    >
                      {block.projectName}
                    </button>
                    <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                      {badges.map((b) => (
                        <span key={b.key} className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums', b.cls)}>
                          {b.label} {b.count}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 区块内容 */}
                  {!collapsed && (
                    <div className="space-y-2.5 p-3.5">
                      {block.active.length === 0 && block.done.length === 0 && (
                        <p className="py-3 text-center text-xs text-slate-400">没有符合条件的任务</p>
                      )}
                      {block.active.map((n) => (
                        <TaskCardMe
                          key={n.id}
                          node={n}
                          myName={name}
                          pending={pending === n.id}
                          blockedFor={blockedFor === n.id}
                          blockedText={blockedText}
                          blockedError={blockedError}
                          onBlockedText={(t) => setBlockedText(t)}
                          onBlockedErrorClear={() => setBlockedError('')}
                          onOpenBlocked={() => {
                            setBlockedFor(n.id);
                            setBlockedText('');
                            setBlockedError('');
                          }}
                          onCloseBlocked={() => {
                            setBlockedFor(null);
                            setBlockedText('');
                            setBlockedError('');
                          }}
                          onPatch={(patch) => void patchItem(n.id, patch)}
                          onOpenComments={() => setCommentNode(n)}
                          onOpenOverview={() => setOverviewId(n.projectId)}
                        />
                      ))}

                      {/* 已完成折叠区 */}
                      {block.done.length > 0 && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => toggleDone(block.projectId)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 transition hover:text-emerald-600"
                          >
                            <ChevronDown className={cn('h-3 w-3 transition-transform', !doneCollapsedP && 'rotate-180')} />
                            {block.done.length} 个已完成
                          </button>
                          {!doneCollapsedP && (
                            <div className="mt-2.5 space-y-2.5">
                              {block.done.map((n) => (
                                <TaskCardMe
                                  key={n.id}
                                  node={n}
                                  myName={name}
                                  pending={pending === n.id}
                                  blockedFor={blockedFor === n.id}
                                  blockedText={blockedText}
                                  blockedError={blockedError}
                                  onBlockedText={(t) => setBlockedText(t)}
                                  onBlockedErrorClear={() => setBlockedError('')}
                                  onOpenBlocked={() => {
                                    setBlockedFor(n.id);
                                    setBlockedText('');
                                    setBlockedError('');
                                  }}
                                  onCloseBlocked={() => {
                                    setBlockedFor(null);
                                    setBlockedText('');
                                    setBlockedError('');
                                  }}
                                  onPatch={(patch) => void patchItem(n.id, patch)}
                                  onOpenComments={() => setCommentNode(n)}
                                  onOpenOverview={() => setOverviewId(n.projectId)}
                                  dimmed
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* 评论面板 */}
      {commentNode && (
        <CommentPanel
          open={!!commentNode}
          onOpenChange={(v) => {
            if (!v) {
              setCommentNode(null);
              refreshCounts();
            }
          }}
          nodeId={commentNode.id}
          nodeName={commentNode.name}
          myName={name}
          onSubmitted={refreshCounts}
        />
      )}

      {/* 项目总览弹窗 */}
      <ProjectOverviewDialog
        projectId={overviewId ?? ''}
        open={overviewId !== null}
        onOpenChange={(v) => {
          if (!v) setOverviewId(null);
        }}
        onDeleted={() => {
          setOverviewId(null);
          void fetchTasks(name);
        }}
      />
    </main>
  );
}

/* ---------- 任务卡片 ---------- */

interface TaskCardMeProps {
  node: MyNodeItem;
  myName: string;
  pending: boolean;
  blockedFor: boolean;
  blockedText: string;
  blockedError: string;
  onBlockedText: (t: string) => void;
  onBlockedErrorClear: () => void;
  onOpenBlocked: () => void;
  onCloseBlocked: () => void;
  onPatch: (patch: { status: string; blocked_note?: string }) => void;
  onOpenComments: () => void;
  onOpenOverview: () => void;
  dimmed?: boolean;
}

function TaskCardMe({
  node,
  myName,
  pending,
  blockedFor,
  blockedText,
  blockedError,
  onBlockedText,
  onBlockedErrorClear,
  onOpenBlocked,
  onCloseBlocked,
  onPatch,
  onOpenComments,
  onOpenOverview,
  dimmed,
}: TaskCardMeProps) {
  const assignees = node.assignees && node.assignees.length > 0 ? node.assignees : [];
  const assigneeLabel =
    assignees.includes(myName) && assignees.length > 1
      ? `我 + ${assignees.length - 1} 人`
      : assignees.includes(myName)
        ? '我'
        : assignees.slice(0, 3).join('、') + (assignees.length > 3 ? ` +${assignees.length - 3}` : '');
  const badge = STATUS_BADGE[node.derivedStatus] ?? STATUS_BADGE.not_started;
  const isBlocked = node.derivedStatus === 'blocked';

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md',
        isBlocked ? 'border-l-4 border-l-amber-400 border-slate-200' : 'border-slate-100',
        node.derivedStatus === 'overdue' && 'border-rose-300',
        dimmed && 'opacity-70 saturate-50'
      )}
    >
      {/* 第一行：项目名 + 状态标签 */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenOverview}
          className="min-w-0 truncate text-left text-[11px] font-medium text-slate-400 transition hover:text-teal-600"
          title={`打开「${node.projectName}」总览`}
        >
          {node.projectName}
        </button>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', badge)}>
          {node.derivedStatus === 'overdue' ? (node.overdueLabel ?? '已超时') : STATUS_TEXT[node.derivedStatus]}
        </span>
      </div>

      {/* 第二行：任务名 */}
      <div className="mt-1.5 break-words text-[15px] font-bold leading-snug text-slate-800">{node.name}</div>

      {/* 第三行：时间 + 负责人 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span className={cn('flex items-center gap-1', node.derivedStatus === 'overdue' && 'font-semibold text-rose-500')}>
          <Clock className="h-3 w-3" />
          {formatWhen(node) || '未设置时间'}
        </span>
        {assigneeLabel && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {assigneeLabel}
          </span>
        )}
      </div>

      {/* 备注一行截断 */}
      {node.note && <p className="mt-1.5 line-clamp-1 text-[11px] text-slate-400">{node.note}</p>}

      {/* 卡住说明 */}
      {isBlocked && node.blockedNote && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700">
          <span className="line-clamp-2">{node.blockedNote}</span>
        </div>
      )}

      {/* 第四行：操作区 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100/80 pt-2.5">
        {/* 状态操作 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {node.status !== 'done' && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onPatch({ status: 'done' })}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              标记完成
            </button>
          )}
          {node.status !== 'blocked' && (
            <button
              type="button"
              disabled={pending}
              onClick={blockedFor ? onCloseBlocked : onOpenBlocked}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-600 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <CircleAlert className="h-3 w-3" />
              标记卡住了
            </button>
          )}
          {(node.status === 'done' || node.status === 'blocked') && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onPatch({ status: 'todo' })}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
            >
              取消标记
            </button>
          )}
        </div>

        {/* 卡住输入 */}
        {blockedFor && node.status !== 'blocked' && (
          <div className="w-full">
            <textarea
              autoFocus
              value={blockedText}
              onChange={(e) => {
                onBlockedText(e.target.value);
                if (e.target.value.trim().length >= 2) onBlockedErrorClear();
              }}
              rows={2}
              placeholder="说明卡在哪里（至少 2 个字）"
              className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
            {blockedError && <p className="mt-1 text-[10px] font-medium text-rose-500">{blockedError}</p>}
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button type="button" onClick={onCloseBlocked} className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100">
                取消
              </button>
              <button
                type="button"
                disabled={pending || blockedText.trim().length < 2}
                onClick={() => onPatch({ status: 'blocked', blocked_note: blockedText.trim() })}
                className="flex min-h-8 items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                提交
              </button>
            </div>
          </div>
        )}

        {/* 评论按钮 */}
        <button
          type="button"
          onClick={onOpenComments}
          className="ml-auto flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-500 transition hover:border-teal-300 hover:text-teal-600"
          title="评论与求助"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {node.commentCount > 0 && <span className="tabular-nums">{node.commentCount}</span>}
          {node.helpCount > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
              <LifeBuoy className="h-2.5 w-2.5" />
              求助 {node.helpCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}