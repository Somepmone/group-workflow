// 项目锁定状态检查（三态锁定：none / workflow / full）
import type { SupabaseClient } from '@supabase/supabase-js';

/** 锁定状态：none=未锁定 / workflow=工作流锁定（结构冻结，人员可改）/ full=完全锁定（结构+人员冻结，执行放行） */
export type LockState = 'none' | 'workflow' | 'full';

export const LOCK_STATES: { value: LockState; label: string; icon: string; desc: string }[] = [
  { value: 'none', label: '未锁定', icon: 'unlock', desc: '工作流与人员均可自由修改' },
  { value: 'workflow', label: '锁定工作流', icon: 'lock', desc: '任务结构冻结，成员与状态仍可修改' },
  { value: 'full', label: '完全锁定', icon: 'lock-closed', desc: '任务结构与成员冻结，状态与评论仍可操作' },
];

/** 从数据库读项目锁定状态（不存在返回 null） */
export async function getProjectLockState(
  client: SupabaseClient,
  projectId: string
): Promise<{ lockState: LockState; project: { id: string; lock_state: LockState } | null }> {
  const { data, error } = await client
    .from('projects')
    .select('id, lock_state')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`查询项目失败: ${error.message}`);
  if (!data) return { lockState: 'none', project: null };
  const ls = (data.lock_state ?? 'none') as LockState;
  return { lockState: ls, project: data };
}

/** 节点结构类字段（workflow/full 锁定后禁止修改） */
export const NODE_STRUCT_FIELDS = [
  'name',
  'node_kind',
  'ddl',
  'point_date',
  'point_all_day',
  'point_start_time',
  'point_end_time',
  'note',
  'prev_node_ids',
  'intent_prev_node_ids',
  'type',
  'position',
];

/** 节点人员类字段（full 锁定后禁止修改；workflow 允许） */
export const NODE_PERSON_FIELDS = ['assignees', 'assignee'];

/** 节点执行类字段（workflow/full 锁定均允许修改——只锁「安排」，不锁「执行」） */
export const NODE_EXEC_FIELDS = ['status', 'blocked_note', 'completed_at'];

/** 锁定校验 → 403（none：全允许；workflow：仅结构字段禁止；full：结构+人员禁止，执行放行） */
export function assertWorkflowEditable(lockState: LockState, changedFields: string[]): { ok: true } | { ok: false; error: string } {
  if (lockState === 'none') return { ok: true };
  const structHit = changedFields.some((f) => NODE_STRUCT_FIELDS.includes(f));
  if (lockState === 'workflow') {
    if (structHit) {
      return { ok: false, error: '工作流已锁定，无法修改任务结构（名称/前置/时间/备注等）。如需调整请在项目总览中解锁。' };
    }
    return { ok: true };
  }
  // full：结构 + 人员禁止修改；执行类（status/blocked_note/completed_at）+ 空字段集合放行
  const personHit = changedFields.some((f) => NODE_PERSON_FIELDS.includes(f));
  if (structHit || personHit) {
    return { ok: false, error: '项目已完全锁定，无法修改任务结构与成员。状态与评论仍可操作。' };
  }
  return { ok: true };
}