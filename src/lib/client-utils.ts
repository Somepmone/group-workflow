'use client';

import type { WorkflowNode } from './types';
import { DERIVED_STATUS_COLOR } from './types';
import type { DerivedStatus } from './types';
import { deriveNodeStatus } from './node-status';

const NICKNAME_KEY = 'gw_nickname';

/** 获取本机昵称（轻量身份），无则返回 null */
export function getLocalNickname(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(NICKNAME_KEY);
  } catch {
    return null;
  }
}

/** 保存本机昵称 */
export function saveLocalNickname(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NICKNAME_KEY, name);
  } catch {
    // ignore
  }
}

/** 安全取当前域名 */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || '';
}

/** 格式化 DDL：显示为 "3月5日 23:59" */
export function formatDDL(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 节点类型 → 颜色基调 */
export const typeStyles: Record<string, string> = {
  linear: 'sky',
  converge: 'amber',
};

/** 解析 YYYY-MM-DDTHH:mm 本地输入为 ISO 字符串 */
export function toISODateTime(localInput: string | undefined): string | null {
  if (!localInput) return null;
  const d = new Date(localInput);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 将 ISO 转为 datetime-local 输入框可用值（本地时区） */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** YYYY-MM-DD → 展示（如 11/21） */
export function formatDayKey(value: string | null): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 点状节点时间段展示：全天 → "11月21日 全天"；带时段 → "11月21日 14:00-16:00" */
export function formatPointTime(node: Pick<WorkflowNode, 'point_date' | 'point_all_day' | 'point_start_time' | 'point_end_time'>): string {
  const day = formatDayKey(node.point_date);
  if (!day) return '';
  if (!node.point_all_day && node.point_start_time && node.point_end_time) {
    return `${day} ${node.point_start_time}-${node.point_end_time}`;
  }
  return `${day} 全天`;
}

/** 完成时间展示：如 "11-21 18:30 完成" */
export function formatCompletedAt(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 节点是否已超时（派生，未完成且现在已过结束时刻） */
export function isNodeOverdue(node: WorkflowNode, allNodes: WorkflowNode[]): boolean {
  return deriveNodeStatus(node, allNodes).isOverdue;
}

/** 派生状态的颜色样式（dot/text/bg/border），未开始灰色 → 进行中 teal → 已超时玫红 */
export function derivedStatusStyles(status: DerivedStatus) {
  return DERIVED_STATUS_COLOR[status] ?? DERIVED_STATUS_COLOR.not_started;
}