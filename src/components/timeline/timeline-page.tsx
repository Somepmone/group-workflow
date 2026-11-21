'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Project, Member, WorkflowNode } from '@/lib/types';
import NicknameGate from '@/components/nickname-gate';
import ViewTabs from '@/components/view-tabs';
import MeLink from '@/components/me-link';
import OverviewButton from '@/components/overview-button';
import MemberAvatars from '@/components/member-avatars';
import { useProjectAutoRefresh } from '@/hooks/use-project-auto-refresh';
import TimelineView from '@/components/timeline/timeline-view';
import TimelineErrorBoundary from '@/components/timeline/timeline-error-boundary';
import { Workflow, ChevronLeft, Users2, Share2 } from 'lucide-react';

interface TimelinePageProps {
  initialProject: Project;
  initialMembers: Member[];
  initialNodes: WorkflowNode[];
}

export default function TimelinePage({ initialProject, initialMembers, initialNodes }: TimelinePageProps) {
  const [project] = useState<Project>(initialProject);
  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [joined, setJoined] = useState(false);

  const handleJoined = useCallback(
    (nickname: string) => {
      setJoined(true);
      setMembers((prev) => {
        if (prev.some((m) => m.name === nickname)) return prev;
        return [
          ...prev,
          { id: `local-${nickname}`, project_id: project.id, name: nickname, created_at: new Date().toISOString() },
        ];
      });
    },
    [project.id]
  );

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
  }

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
              <div className="flex items-center gap-2 overflow-x-auto">
                {/* 成员头像 + 数量 */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <MemberAvatars members={members} />
                  <span className="hidden text-[11px] text-slate-400 sm:inline">{members.length} 人</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/project/${project.id}`).catch(() => undefined);
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-600"
                  title="复制项目链接"
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">邀请</span>
                </button>
                <ViewTabs projectId={project.id} active="timeline" />
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
                <span className="text-slate-500">时间轴</span>
              </div>
              <p className="text-[11px] text-slate-400">
                甘特图式时间轴：任务的起点取前置节点截止的最晚值，终点为自身截止时间
              </p>
            </div>

            <TimelineErrorBoundary>
              <TimelineView project={project} nodes={nodes} members={members} onUpdate={patchNode} />
            </TimelineErrorBoundary>
          </main>
        </div>
      )}
    </NicknameGate>
  );
}