'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Project, Member, WorkflowNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getBaseUrl } from '@/lib/client-utils';
import { computeWorkflowLabels } from '@/lib/workflow-labels';
import { deriveNodeStatus } from '@/lib/node-status';
import { DERIVED_STATUSES } from '@/lib/types';
import type { RemovedEdge } from '@/lib/node-types';
import NicknameGate from '@/components/nickname-gate';
import ShareDialog from '@/components/share-dialog';
import ViewTabs from '@/components/view-tabs';
import MeLink from '@/components/me-link';
import MemberAvatars from '@/components/member-avatars';
import OverviewButton from '@/components/overview-button';
import { useProjectAutoRefresh } from '@/hooks/use-project-auto-refresh';
import { toast } from 'sonner';
import FlowCanvas from '@/components/builder/flow-canvas';
import NodeEditor from '@/components/builder/node-editor';
import {
  Workflow,
  Plus,
  Share2,
  ChevronLeft,
  CircleDot,
  ListChecks,
  Sparkles,
} from 'lucide-react';

interface BuilderPageProps {
  initialProject: Project;
  initialMembers: Member[];
  initialNodes: WorkflowNode[];
}

export default function BuilderPage({ initialProject, initialMembers, initialNodes }: BuilderPageProps) {
  const [project] = useState<Project>(initialProject);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
  const [selectedId, setSelectedId] = useState<string | null>(initialNodes[0]?.id ?? null);
  const [shareOpen, setShareOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState('');
  // 冗余依赖自动简化提示
  const [simplifyNotice, setSimplifyNotice] = useState<string | null>(null);
  const simplifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 在有效边（prev_node_ids）图中查找 from→…→to 的覆盖路径（BFS，不含直接边） */
  const findCoveringPath = useCallback((from: string, to: string, allNodes: WorkflowNode[]): string[] | null => {
    const adj = new Map<string, string[]>();
    allNodes.forEach((n) => {
      (n.prev_node_ids ?? []).forEach((p) => {
        if (p === from && n.id === to) return; // 跳过被移除的直接边
        adj.set(p, [...(adj.get(p) ?? []), n.id]);
      });
    });
    const queue: string[] = [from];
    const parent = new Map<string, string | null>([[from, null]]);
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (cur === to) break;
      for (const next of adj.get(cur) ?? []) {
        if (parent.has(next)) continue;
        parent.set(next, cur);
        queue.push(next);
      }
    }
    if (!parent.has(to)) return null;
    const path: string[] = [];
    let cur: string | null = to;
    while (cur !== null) {
      path.unshift(cur);
      cur = parent.get(cur) ?? null;
    }
    return path;
  }, []);

  const showSimplifyNotice = useCallback((edges: RemovedEdge[], allNodes?: WorkflowNode[]) => {
    if (!edges || edges.length === 0) return;
    // 从最新节点列表中查询节点名（fallback 用 id）
    const pool = Array.isArray(allNodes) && allNodes.length > 0 ? allNodes : nodes;
    const nameOf = (id: string) => pool.find((n) => n.id === id)?.name ?? '节点';
    const desc = edges.map((e) => {
      const path = findCoveringPath(e.from, e.to, pool);
      if (path && path.length >= 3) {
        const segs = path.map(nameOf);
        return `「${segs[0]} → ${segs[segs.length - 1]}」已被「${segs.join(' → ')}」覆盖`;
      }
      return `「${nameOf(e.from)} → ${nameOf(e.to)}」已简化`;
    });
    setSimplifyNotice(`已自动简化冗余依赖：${desc.join('；')}`);
    if (simplifyTimer.current) clearTimeout(simplifyTimer.current);
    simplifyTimer.current = setTimeout(() => setSimplifyNotice(null), 4000);
  }, [nodes, findCoveringPath]);

  // 卸载时清理提示定时器
  useEffect(() => () => {
    if (simplifyTimer.current) clearTimeout(simplifyTimer.current);
  }, []);

  const baseUrl = getBaseUrl();
  const sharePath = `${baseUrl}/project/${project.id}`;

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );

  // 按 DAG 依赖计算纯整数编号（1、2、3…，按拓扑序连续）
  const nodeLabels = useMemo(() => computeWorkflowLabels(nodes), [nodes]);

  // 其他页面留下的当前昵称（新成员加入后从 NicknameGate 获取）
  const [currentNickname, setCurrentNickname] = useState('');

  function handleJoined(nickname: string) {
    setCurrentNickname(nickname);
    setJoined(true);
    // 若为新成员，追加到成员列表（NicknameGate 已调用加入接口）
    setMembers((prev) => {
      if (prev.some((m) => m.name === nickname)) return prev;
      return [...prev, { id: `local-${nickname}`, project_id: project.id, name: nickname, created_at: new Date().toISOString() }];
    });
  }

  // 多设备协作：每 10 秒静默自动刷新（弹窗打开 / 输入聚焦时暂停）
  useProjectAutoRefresh({
    enabled: joined,
    projectId: project.id,
    onData: useCallback((data) => {
      setMembers(data.members ?? []);
      setNodes(data.nodes ?? []);
    }, []),
  });

  async function patchNode(nodeId: string, patch: Record<string, unknown>) {
    setSaving((prev) => new Set(prev).add(nodeId));
    try {
      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');
      // 类型可能连锁变化，用全量节点更新
      setNodes(Array.isArray(data.nodes) ? data.nodes : (prev) => prev.map((n) => (n.id === nodeId ? data.node : n)));
      if (Array.isArray(data.removedEdges)) showSimplifyNotice(data.removedEdges, Array.isArray(data.nodes) ? data.nodes : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }

  async function addNode() {
    setAdding(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `新任务 ${nodes.length + 1}`, assignees: [], node_kind: 'ddl', prev_node_ids: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      // 新节点默认无前置 → 类型为线性（由后端推断）
      setNodes(Array.isArray(data.nodes) ? data.nodes : (prev) => [...prev, data.node]);
      setSelectedId(Array.isArray(data.nodes) ? (data.nodes[data.nodes.length - 1]?.id ?? data.node.id) : data.node.id);
      if (Array.isArray(data.removedEdges)) showSimplifyNotice(data.removedEdges, Array.isArray(data.nodes) ? data.nodes : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setAdding(false);
    }
  }

  async function deleteNode(nodeId: string) {
    try {
      const res = await fetch(`/api/nodes/${nodeId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      // 后端已解除其他节点对它的引用并重算类型
      setNodes(Array.isArray(data.nodes) ? data.nodes : (prev) => prev.filter((n) => n.id !== nodeId));
      setSelectedId((prev) => (prev === nodeId ? null : prev));
      if (Array.isArray(data.removedEdges)) showSimplifyNotice(data.removedEdges, Array.isArray(data.nodes) ? data.nodes : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }

  return (
    <NicknameGate projectName={project.name} existingNames={members.map((m) => m.name)} onJoined={handleJoined}>
      {joined && currentNickname && (
        <div className="min-h-screen bg-[#f6f8f8]">
          {/* 顶部栏 */}
          <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
            <div className="mx-auto flex h-15 max-w-6xl items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link href="/" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500 shadow-md shadow-teal-200">
                  <Workflow className="h-5 w-5 text-white" />
                </Link>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold text-slate-800">{project.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <CircleDot className="h-3 w-3" />
                    组长：{project.owner_name}
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
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-teal-200 transition hover:bg-teal-600 active:scale-95"
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">分享</span>
                </button>
                <ViewTabs projectId={project.id} active="flow" />
                <OverviewButton projectId={project.id} />
                <MeLink />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-6">
            {/* 冗余依赖简化提示 */}
            {simplifyNotice && (
              <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
                <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-xs font-medium text-teal-700 shadow-lg shadow-teal-100/60 animate-in fade-in slide-in-from-top-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100">
                    <Sparkles className="h-3 w-3 text-teal-600" />
                  </span>
                  {simplifyNotice}
                </div>
              </div>
            )}

            {/* 面包屑 */}
            <div className="mb-4 flex items-center gap-1 text-xs text-slate-400">
              <Link href="/" className="flex items-center gap-0.5 hover:text-slate-600">
                <ChevronLeft className="h-3 w-3" />
                首页
              </Link>
              <span>/</span>
              <span className="text-slate-500">工作流</span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
              {/* 左侧：节点列表 */}
              <aside className="flex flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-50 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-teal-500" />
                    <span className="text-sm font-semibold text-slate-700">节点列表</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                      {nodes.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={addNode}
                    disabled={adding}
                    className="flex items-center gap-1 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-600 transition hover:bg-teal-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    节点
                  </button>
                </div>
                <div className="max-h-[460px] flex-1 space-y-1 overflow-y-auto p-3">
                  {nodes.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-slate-400">暂无节点，点击右上角「+ 节点」添加</p>
                  )}
                  {nodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
                        selectedId === n.id
                          ? 'border-teal-300 bg-teal-50/60'
                          : 'border-transparent hover:bg-slate-50'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-6 shrink-0 items-center justify-center rounded-lg px-1.5 text-[11px] font-bold text-white',
                          n.type === 'linear' ? 'bg-sky-500' : 'bg-amber-500'
                        )}
                      >
                        {nodeLabels.get(n.id) ?? '-'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-700">{n.name}</span>
                        <span className="block text-[11px] text-slate-400">
                          {(n.assignees?.length ? n.assignees[0] + (n.assignees.length > 1 ? ` +${n.assignees.length - 1}` : '') : '待分配')} · {DERIVED_STATUSES.find((s) => s.value === deriveNodeStatus(n, nodes).status)?.label ?? ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              {/* 右侧：选中节点详情 */}
              <section className="min-w-0">
                {selectedNode ? (
                  <NodeEditor
                    key={selectedNode.id}
                    node={selectedNode}
                    nodes={nodes}
                    members={members}
                    onUpdate={patchNode}
                    onDelete={deleteNode}
                  />
                ) : (
                  <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/60">
                    <CircleDot className="h-8 w-8 text-slate-300" />
                    <p className="text-sm text-slate-400">选择左侧一个节点进行编辑</p>
                  </div>
                )}
              </section>
            </div>

            {/* 底部：流程图 */}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <Workflow className="h-4 w-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-500">点击节点卡片可定位编辑</span>
              </div>
              <FlowCanvas
                nodes={nodes}
                members={members}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </main>

          <ShareDialog open={shareOpen} onOpenChange={setShareOpen} projectId={project.id} projectName={project.name} />
        </div>
      )}
    </NicknameGate>
  );
}