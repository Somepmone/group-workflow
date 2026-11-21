'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Project, Member, WorkflowNode, NodeStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { deriveNodeStatus } from '@/lib/node-status';
import NicknameGate from '@/components/nickname-gate';
import TaskCard from '@/components/board/task-card';
import NodeDetailDialog from '@/components/board/node-detail-dialog';
import MemberAvatars from '@/components/member-avatars';
import { useProjectAutoRefresh } from '@/hooks/use-project-auto-refresh';
import ViewTabs from '@/components/view-tabs';
import MeLink from '@/components/me-link';
import OverviewButton from '@/components/overview-button';
import CommentPanel from '@/components/comment-panel';
import { getLocalNickname } from '@/lib/client-utils';
import { toast } from 'sonner';
import {
  Workflow,
  ChevronLeft,
  Users2,
  ListChecks,
  Share2,
  User as UserIcon,
  ChevronDown,
} from 'lucide-react';

interface BoardPageProps {
  initialProject: Project;
  initialMembers: Member[];
  initialNodes: WorkflowNode[];
}

/** 派生状态列定义（5 列：未开始 / 进行中 / 卡住了 / 已超时 / 已完成） */
const STATUS_COLUMNS: { key: string; label: string; bar: string; count: string }[] = [
  { key: 'not_started', label: '未开始', bar: 'bg-slate-300', count: 'bg-slate-100 text-slate-500' },
  { key: 'in_progress', label: '进行中', bar: 'bg-teal-400', count: 'bg-teal-50 text-teal-600' },
  { key: 'blocked', label: '卡住了', bar: 'bg-amber-400', count: 'bg-amber-50 text-amber-600' },
  { key: 'overdue', label: '已超时', bar: 'bg-rose-400', count: 'bg-rose-50 text-rose-600' },
  { key: 'done', label: '已完成', bar: 'bg-emerald-400', count: 'bg-emerald-50 text-emerald-600' },
];

type ViewMode = 'person' | 'status';

export default function BoardPage({ initialProject, initialMembers, initialNodes }: BoardPageProps) {
  const [project] = useState<Project>(initialProject);
  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [view, setView] = useState<ViewMode>('status');
  const [joined, setJoined] = useState(false);
  const [detailNode, setDetailNode] = useState<WorkflowNode | null>(null);
  // 评论计数聚合：{ [nodeId]: { commentCount, helpCount } }
  const [commentCounts, setCommentCounts] = useState<Record<string, { commentCount: number; helpCount: number }>>({});
  // 评论面板打开的目标节点
  const [commentPanelNode, setCommentPanelNode] = useState<WorkflowNode | null>(null);
  // 「已完成」列默认折叠，点击标题展开
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  // 拉取项目评论计数（加入后 + 评论面板关闭后刷新）
  const refreshCommentCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/comment-counts`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '加载评论失败');
        return;
      }
      setCommentCounts(data.counts ?? {});
    } catch {
      // 静默失败，不影响看板主流程
    }
  }, [project.id]);

  useEffect(() => {
    if (joined) void refreshCommentCounts();
  }, [joined, refreshCommentCounts]);

  const handleJoined = useCallback((nickname: string) => {
    setJoined(true);
    setMembers((prev) => {
      if (prev.some((m) => m.name === nickname)) return prev;
      return [...prev, { id: `local-${nickname}`, project_id: project.id, name: nickname, created_at: new Date().toISOString() }];
    });
  }, [project.id]);

  // 多设备协作：每 10 秒静默自动刷新（弹窗打开 / 输入聚焦时暂停）
  useProjectAutoRefresh({
    enabled: joined,
    projectId: project.id,
    onData: useCallback((data) => {
      setNodes(data.nodes ?? []);
      setMembers(data.members ?? []);
    }, []),
  });

  async function patchNode(nodeId: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '更新失败');
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? data.node : n)));
    return data.node;
  }

  // 状态切换：乐观更新（先换列）→ 请求 → 失败回滚并抛错（由 TaskCard 弹 toast）
  const handleStatusChange = useCallback(
    async (nodeId: string, patch: { status: NodeStatus; blocked_note?: string }) => {
      const prevNode = nodes.find((n) => n.id === nodeId);
      if (!prevNode) return;
      const nowIso = new Date().toISOString();
      // 乐观更新：done 补 completed_at；todo 清空标记
      const optimistic: WorkflowNode = {
        ...prevNode,
        status: patch.status,
        ...(patch.blocked_note !== undefined ? { blocked_note: patch.blocked_note } : {}),
        ...(patch.status === 'done' ? { completed_at: nowIso } : patch.status === 'todo' ? { completed_at: null, blocked_note: null } : { completed_at: null }),
      };
      setNodes((cur) => cur.map((n) => (n.id === nodeId ? optimistic : n)));
      try {
        await patchNode(nodeId, patch);
      } catch (err) {
        setNodes((cur) => cur.map((n) => (n.id === nodeId ? prevNode : n)));
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes]
  );

  /** 按派生状态分组（ready 可进行归入进行中列） */
  const statusGroups = useMemo(() => {
    const map: Record<string, WorkflowNode[]> = { not_started: [], in_progress: [], blocked: [], overdue: [], done: [] };
    nodes.forEach((n) => {
      const statusKey = deriveNodeStatus(n, nodes).status;
      // ready（前置已完成、未到开始时间）→ 归入「进行中」列，不单独开列
      const k = statusKey === 'ready' ? 'in_progress' : statusKey;
      if (map[k]) map[k].push(n);
    });
    return map;
  }, [nodes]);

  // 按人视图分组：多负责人时同一节点在每个人分组都出现；未分配进「待分配」列
  const personGroups = useMemo(() => {
    const groups: { name: string; nodes: WorkflowNode[] }[] = [];
    members.forEach((m) => {
      const list: WorkflowNode[] = [];
      nodes.forEach((n) => {
        const assignees = n.assignees && n.assignees.length > 0 ? n.assignees : (n.assignee ? [n.assignee] : []);
        if (assignees.includes(m.name)) list.push(n);
      });
      if (list.length > 0) groups.push({ name: m.name, nodes: list });
    });
    const covered = new Set<string>();
    nodes.forEach((n) => {
      const assignees = n.assignees && n.assignees.length > 0 ? n.assignees : (n.assignee ? [n.assignee] : []);
      assignees.forEach((a) => covered.add(a));
    });
    const unassignedNodes = nodes.filter((n) => {
      const assignees = n.assignees && n.assignees.length > 0 ? n.assignees : (n.assignee ? [n.assignee] : []);
      return assignees.length === 0 || !assignees.some((a) => members.some((m) => m.name === a));
    });
    if (unassignedNodes.length > 0) groups.push({ name: '待分配', nodes: unassignedNodes });
    void covered;
    return groups;
  }, [nodes, members]);

  const avatarColors = ['bg-teal-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500'];

  return (
    <NicknameGate projectName={project.name} existingNames={members.map((m) => m.name)} onJoined={handleJoined}>
      {joined && (
        <div className="min-h-screen bg-[#f6f8f8]">
          {/* 顶部栏 */}
          <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
            <div className="mx-auto flex h-15 max-w-7xl items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link href="/" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500 shadow-md shadow-teal-200">
                  <Workflow className="h-5 w-5 text-white" />
                </Link>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold text-slate-800">{project.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <Users2 className="h-3 w-3" />
                    {members.length} 人协作
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* 成员头像 + 数量 */}
                <div className="flex items-center gap-1.5">
                  <MemberAvatars members={members} />
                  <span className="hidden text-[11px] text-slate-400 sm:inline">{members.length} 人</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/project/${project.id}`).catch(() => undefined);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-600"
                  title="复制项目链接"
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">邀请</span>
                </button>
                <ViewTabs projectId={project.id} active="board" />
                <OverviewButton projectId={project.id} />
                <MeLink />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Link href="/" className="flex items-center gap-0.5 hover:text-slate-600">
                  <ChevronLeft className="h-3 w-3" />
                  首页
                </Link>
                <span>/</span>
                <span className="text-slate-500">看板</span>
              </div>

              {/* 视图切换 */}
              <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setView('status')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition',
                    view === 'status' ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <ListChecks className="h-4 w-4" />
                  按状态
                </button>
                <button
                  type="button"
                  onClick={() => setView('person')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition',
                    view === 'person' ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <UserIcon className="h-4 w-4" />
                  按人
                </button>
              </div>
            </div>

            {/* 内容区 */}
            {view === 'status' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {STATUS_COLUMNS.map((col) => {
                  const colNodes = statusGroups[col.key] ?? [];
                  const isDone = col.key === 'done';
                  const collapsed = isDone && doneCollapsed;
                  return (
                    <div key={col.key} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                      <button
                        type="button"
                        className={cn(
                          'mb-3 flex w-full items-center gap-2 px-1 text-left',
                          isDone && 'items-center'
                        )}
                        onClick={isDone ? () => setDoneCollapsed((v) => !v) : undefined}
                      >
                        <span className={cn('h-2.5 w-2.5 rounded-full', col.bar)} />
                        <span className="text-sm font-semibold text-slate-700">{col.label}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', col.count)}>
                          {colNodes.length}
                        </span>
                        {isDone && (
                          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-slate-400">
                            {doneCollapsed ? '展开' : '收起'}
                            <ChevronDown className={cn('h-3 w-3 transition-transform', !doneCollapsed && 'rotate-180')} />
                          </span>
                        )}
                      </button>
                      {!collapsed && (
                        <div className={cn(
                          'max-h-[60vh] space-y-2.5 overflow-y-auto pr-0.5',
                          isDone && 'opacity-85 saturate-[.85]'
                        )}>
                          {colNodes.length === 0 && (
                            <p className="px-1 py-8 text-center text-xs text-slate-300">暂无任务</p>
                          )}
                          {colNodes.map((n) => {
                            const cc = commentCounts[n.id] ?? { commentCount: 0, helpCount: 0 };
                            return (
                              <TaskCard
                                key={n.id}
                                node={n}
                                nodes={nodes}
                                onClick={() => setDetailNode(n)}
                                onStatusChange={handleStatusChange}
                                commentCount={cc.commentCount}
                                helpCount={cc.helpCount}
                                onOpenComments={() => setCommentPanelNode(n)}
                              />
                            );
                          })}
                          {isDone && colNodes.length === 0 && (
                            <p className="px-1 py-2 text-center text-[11px] text-slate-300">暂无已完成任务</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'person' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {personGroups.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-slate-100 bg-white py-14 text-center text-sm text-slate-400">
                    还没有任务，去流程图添加第一个节点吧
                  </div>
                )}
                {personGroups.map((group, gi) => {
                  const isUnassigned = group.name === '待分配';
                  return (
                    <div key={`${group.name}-${gi}`} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="mb-3 flex items-center gap-2 px-1">
                        {!isUnassigned ? (
                          <span
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white',
                              avatarColors[gi % avatarColors.length]
                            )}
                          >
                            {group.name.charAt(0)}
                          </span>
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-white">
                            ?
                          </span>
                        )}
                        <span className="truncate text-sm font-semibold text-slate-700">{group.name}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          {group.nodes.length}
                        </span>
                      </div>
                      <div className="max-h-[60vh] space-y-2.5 overflow-y-auto pr-0.5">
                        {group.nodes.map((n) => {
                          const cc = commentCounts[n.id] ?? { commentCount: 0, helpCount: 0 };
                          return (
                            <TaskCard
                              key={n.id}
                              node={n}
                              nodes={nodes}
                              onClick={() => setDetailNode(n)}
                              onStatusChange={handleStatusChange}
                              commentCount={cc.commentCount}
                              helpCount={cc.helpCount}
                              onOpenComments={() => setCommentPanelNode(n)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          {detailNode && (
            <NodeDetailDialog
              node={detailNode}
              nodes={nodes}
              members={members}
              open={Boolean(detailNode)}
              onOpenChange={(open) => {
                if (!open) setDetailNode(null);
              }}
              onUpdate={patchNode}
            />
          )}

          {/* 评论与求助面板（卡片评论按钮打开；关闭后刷新计数） */}
          {commentPanelNode && (
            <CommentPanel
              open={Boolean(commentPanelNode)}
              onOpenChange={(open) => {
                if (!open) setCommentPanelNode(null);
                void refreshCommentCounts();
              }}
              nodeId={commentPanelNode.id}
              nodeName={commentPanelNode.name}
              myName={getLocalNickname()}
              onSubmitted={refreshCommentCounts}
            />
          )}
        </div>
      )}
    </NicknameGate>
  );
}