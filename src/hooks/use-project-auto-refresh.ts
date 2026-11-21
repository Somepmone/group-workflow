'use client';

import { useEffect, useRef } from 'react';
import type { Member, WorkflowNode } from '@/lib/types';

/**
 * 项目快照：自动刷新后的最新数据（与 GET /api/projects/[id] 返回结构一致）
 */
export interface ProjectSnapshot {
  members: Member[];
  nodes: WorkflowNode[];
}

/** 每个节点参与指纹的关键字段（覆盖改名 / 改 DDL / 改状态 / 前置 / 负责人 / 备注 / 点状等变化） */
function nodeFingerprint(n: WorkflowNode): string {
  return [
    n.id,
    n.name,
    n.ddl ?? '',
    n.status,
    (n.assignees ?? []).join(','),
    n.assignee ?? '',
    n.node_kind,
    n.point_date ?? '',
    String(n.point_all_day ?? true),
    n.point_start_time ?? '',
    n.point_end_time ?? '',
    n.note ?? '',
    n.blocked_note ?? '',
    n.completed_at ?? '',
    (n.prev_node_ids ?? []).join(','),
    (n.intent_prev_node_ids ?? []).join(';'),
    n.type,
    n.position,
  ].join('|');
}

/**
 * 轻量指纹：members 数量 + nodes 数量 + 每个节点关键字段。
 * 数据未变化时指纹不变 → 调用方据此跳过 setState，避免无谓重渲染。
 */
export function projectFingerprint(data: ProjectSnapshot): string {
  const nodesPart = (data.nodes ?? []).map(nodeFingerprint).sort().join('~');
  return `${(data.members ?? []).length}:${(data.nodes ?? []).length}:${nodesPart}`;
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

interface UseProjectAutoRefreshOptions {
  /** 用户已通过昵称门槛进入后置 true，自动刷新才启用 */
  enabled: boolean;
  projectId: string;
  /** 数据确实变化时的回调（通常 setMembers + setNodes） */
  onData: (data: ProjectSnapshot) => void;
}

/**
 * 每 10 秒静默拉取项目快照，供多设备协作实时同步：
 * - 仅在 document.visibilityState === 'visible' 时发请求；切回前台立即刷新一次
 * - 指纹无变化 → 跳过 onData（不触发重渲染）
 * - 节点详情弹窗打开（wf:editing 事件）或 input/textarea/select 聚焦 → 暂停刷新；
 *   关闭弹窗 / 失焦后恢复并立即刷新一次
 * - 刷新失败静默跳过，下一周期自动重试
 */
export function useProjectAutoRefresh({ enabled, projectId, onData }: UseProjectAutoRefreshOptions) {
  const editingRef = useRef(false);
  const lastFpRef = useRef<string | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const doFetchRef = useRef<() => Promise<void>>(async () => {
    if (editingRef.current) return; // 弹窗打开 / 输入聚焦时暂停刷新
    try {
      const res = await fetch(`/api/projects/${projectIdRef.current}`);
      if (!res.ok) return;
      const data = (await res.json()) as ProjectSnapshot;
      if (!Array.isArray(data.nodes) || !Array.isArray(data.members)) return;
      const fp = projectFingerprint(data);
      if (fp === lastFpRef.current) return; // 数据无变化 → 不触发重渲染
      if (editingRef.current) return; // 返回瞬间进入编辑：不落库也不缓存，等关闭后立即刷新
      lastFpRef.current = fp;
      onDataRef.current(data);
    } catch {
      // 静默跳过，下个周期重试
    }
  });

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (document.visibilityState !== 'visible') return; // 后台标签页不请求
      void doFetchRef.current();
    };

    const onEditingEvent = (e: Event) => {
      const open = Boolean((e as CustomEvent<boolean>).detail);
      editingRef.current = open;
      if (!open) refresh(); // 弹窗关闭后恢复：立即刷新一次
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest?.(EDITABLE_SELECTOR)) editingRef.current = true;
    };
    const onFocusOut = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest?.(EDITABLE_SELECTOR)) return;
      const next = document.activeElement;
      if (!(next instanceof HTMLElement) || !next.closest?.(EDITABLE_SELECTOR)) {
        editingRef.current = false;
        refresh(); // 失焦后恢复：立即刷新一次
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh(); // 切回前台立即刷新一次
    };

    window.addEventListener('wf:editing', onEditingEvent);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('visibilitychange', onVisibilityChange);
    refresh(); // 进入后立即同步一次

    const timer = window.setInterval(refresh, 10_000);
    return () => {
      window.removeEventListener('wf:editing', onEditingEvent);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId]);
}