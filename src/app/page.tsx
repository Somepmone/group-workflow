'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Workflow, Users, UserRound, MoreHorizontal, Plus, Trash2, Copy, ArrowRight, Lock, LockKeyhole, Clock } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import CreateProjectForm from '@/components/create-project-form';
import ProjectOverviewDialog from '@/components/project-overview-dialog';
import { toast } from 'sonner';

interface HomeProject {
  id: string;
  name: string;
  template: string;
  owner_name: string;
  lock_state: string;
  created_at: string;
  updated_at: string;
  nodeCount: number;
  members: { name: string }[];
}

const LOCK_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  none: { label: '未锁定', icon: Lock, cls: 'text-slate-400 border-slate-200 bg-slate-50' },
  workflow: { label: '工作流锁定', icon: Lock, cls: 'text-amber-600 border-amber-200 bg-amber-50' },
  full: { label: '完全锁定', icon: LockKeyhole, cls: 'text-rose-600 border-rose-200 bg-rose-50' },
};

export default function HomePage() {
  const [projects, setProjects] = useState<HomeProject[] | null>(null);
  const [overviewId, setOverviewId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // 点击外部关闭「⋯」菜单
  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuFor]);

  async function copyLink(id: string) {
    const link = `${window.location.origin}/project/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('链接已复制', { duration: 1500 });
    } catch {
      toast.error('复制失败，请手动复制');
    }
  }

  const overviewProject = useMemo(
    () => (overviewId ? projects?.find((p) => p.id === overviewId) ?? null : null),
    [overviewId, projects]
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-teal-50/70 via-slate-50 to-slate-50">
      {/* 顶部装饰条 */}
      <div className="h-1.5 w-full bg-gradient-to-r from-teal-500 via-cyan-500 to-teal-400" />

      {/* 「我的任务」入口 */}
      <div className="mx-auto flex max-w-6xl items-center justify-end px-4 pt-5">
        <Link
          href="/me"
          className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-white px-4 py-2 text-xs font-semibold text-teal-600 shadow-sm transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
        >
          <UserRound className="h-4 w-4" />
          我的任务
        </Link>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-6px)] max-w-6xl flex-col px-4 py-12 md:py-14">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500 shadow-xl shadow-teal-200">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-800 md:text-4xl">
            小组作业工作流
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-500 md:text-base">
            把小组作业拆成一条清晰的节点流水线，
            <br className="hidden md:block" />
            任务分得下去、DDL 看得见，不再有人摸鱼。
          </p>
          <div className="mt-6 flex items-center gap-2 rounded-full border border-teal-100 bg-white px-4 py-1.5 text-xs text-teal-600 shadow-sm">
            <Users className="h-3.5 w-3.5" />
            分享链接即可加入，无需注册登录
          </div>
        </div>

        {/* 创建表单 */}
        <Card className="mt-10 w-full max-w-xl self-center border-slate-100 bg-white/90 shadow-xl shadow-slate-200/50 backdrop-blur">
          <CardContent className="p-6 md:p-8">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Plus className="h-4 w-4 text-teal-500" />
              新建项目
            </div>
            <CreateProjectForm />
          </CardContent>
        </Card>

        {/* 项目列表 */}
        <section className="mt-12 w-full">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-800">我的项目</h2>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-bold text-teal-600 tabular-nums">
              {projects?.length ?? 0}
            </span>
          </div>

          {projects === null ? (
            <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 py-12 text-center">
              <Users className="h-8 w-8 text-slate-200" />
              <p className="text-sm font-medium text-slate-500">还没有项目</p>
              <p className="max-w-xs text-xs text-slate-400">用上方表单新建一个小组项目，或者打开好友分享的链接加入</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => {
                const lock = LOCK_META[p.lock_state] ?? LOCK_META.none;
                const LockIcon = lock.icon;
                const updated = new Date(p.updated_at);
                return (
                  <div
                    key={p.id}
                    onClick={() => setOverviewId(p.id)}
                    className="group relative cursor-pointer rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-lg hover:shadow-teal-100/40"
                  >
                    {/* 锁定标识 + 「⋯」菜单 */}
                    <div className="absolute right-3.5 top-3.5 flex items-center gap-1.5">
                      {(p.lock_state === 'workflow' || p.lock_state === 'full') && (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${lock.cls}`}>
                          <LockIcon className="h-3 w-3" />
                          {lock.label}
                        </span>
                      )}
                      <div className="relative" ref={menuFor === p.id ? menuRef : undefined}>
                        <button
                          type="button"
                          aria-label="更多操作"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === p.id ? null : p.id);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuFor === p.id && (
                          <div
                            className="absolute right-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link href={`/project/${p.id}`} className="flex items-center gap-2 px-3.5 py-2 text-xs text-slate-600 transition hover:bg-teal-50">
                              <ArrowRight className="h-3.5 w-3.5" />
                              进入项目
                            </Link>
                            <button
                              type="button"
                              onClick={() => void copyLink(p.id)}
                              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs text-slate-600 transition hover:bg-teal-50"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              复制链接
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuFor(null);
                                // 打开总览，用户可在底部点「删除项目」走确认流程
                                setOverviewId(p.id);
                              }}
                              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs text-rose-500 transition hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <h3 className="pr-8 text-[15px] font-bold text-slate-800">{p.name}</h3>
                    <p className="mt-1 text-[11px] text-slate-400">
                      组长：{p.owner_name} · {p.template === 'blank' ? '空白模板' : '模板项目'}
                    </p>

                    {/* 成员头像圈 */}
                    <div className="mt-4 flex items-center">
                      <div className="flex -space-x-1.5">
                        {p.members.slice(0, 5).map((m, i) => (
                          <span
                            key={`${p.id}-${i}`}
                            title={m.name}
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-teal-500 to-sky-500 text-[10px] font-bold text-white"
                          >
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                        {p.members.length > 5 && (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold text-slate-500">
                            +{p.members.length - 5}
                          </span>
                        )}
                        {p.members.length === 0 && <span className="text-[11px] text-slate-300">暂无成员</span>}
                      </div>
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="h-3 w-3" />
                        {updated.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} 更新
                      </span>
                    </div>

                    {/* 底部：节点数 */}
                    <div className="mt-3 flex items-center gap-1 border-t border-slate-50 pt-3 text-[11px] text-slate-400">
                      <Workflow className="h-3 w-3" />
                      {p.nodeCount} 个节点
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 项目总览弹窗（未加载到时兜底展示项目 id 名） */}
      <ProjectOverviewDialog
        projectId={overviewId ?? ''}
        open={overviewId !== null && overviewProject !== undefined}
        onOpenChange={(v) => {
          if (!v) setOverviewId(null);
        }}
        onDeleted={() => {
          setOverviewId(null);
          void fetchProjects();
        }}
      />
    </main>
  );
}