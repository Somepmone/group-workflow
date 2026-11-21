// 项目数据结构类型定义

/** 节点类型：linear=普通(默认，入度<=1)，converge=汇聚(合并，入度>=2) */
export type NodeType = 'linear' | 'converge';

/**
 * 节点存储状态（用户主动设置，唯一落库值）：
 * - todo：默认/未标记（未标记 = 未开始/进行中/已超时由时间派生）
 * - done：已完成（写 completed_at）
 * - blocked：卡住了（必填 blocked_note）
 */
export type NodeStatus = 'todo' | 'done' | 'blocked';

/**
 * 派生状态（前端实时计算，不落库；不存在不可用=灰/进行中=teal/可进行=teal暗/已超时=玫红/已完成=绿/卡住了=橙）
 * ready=可进行：有前置且前置全部完成，但未到计划开始时间（视觉近似进行中但颜色稍暗）
 * 计算见 src/lib/node-status.ts
 */
export type DerivedStatus = 'not_started' | 'in_progress' | 'ready' | 'overdue' | 'done' | 'blocked';

/** 节点形态：ddl=截止日型（有 DDL），point=点状节点（会议/答辩等，只占一天，可带时间段） */
export type NodeKind = 'ddl' | 'point';

/** DDL 严格程度（已弃用：保留字段与枚举以兼容存量，UI/写接口均不再使用） */
export type Strictness = 'hard' | 'soft' | 'flexible';

/** 项目模板 */
export type ProjectTemplate = 'course_report' | 'experiment_report' | 'club_activity' | 'blank';

export interface Project {
  id: string;
  name: string;
  template: ProjectTemplate;
  owner_name: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

export interface WorkflowNode {
  id: string;
  project_id: string;
  name: string;
  type: NodeType;
  /** 兼容字段：始终同步为 assignees[0]（多负责人请读 assignees） */
  assignee: string | null;
  /** 负责人昵称数组（多选，至少 1 个） */
  assignees: string[];
  ddl: string | null;
  strictness: Strictness;
  /** 节点形态 */
  node_kind: NodeKind;
  /** 点状节点日期（node_kind='point' 时有值，'YYYY-MM-DD'） */
  point_date: string | null;
  /** 点状是否整天（默认 true） */
  point_all_day: boolean;
  /** 点状开始时间 'HH:mm'（all_day=false 时有效） */
  point_start_time: string | null;
  /** 点状结束时间 'HH:mm'（all_day=false 时有效） */
  point_end_time: string | null;
  /** 备注（取代严格程度；时间轴/看板/详情只读展示） */
  note: string;
  /** 有效边（派生视图）：由 intent_prev_node_ids 经传递约简计算，所有渲染/类型/拓扑/编号基于它 */
  prev_node_ids: string[];
  /** 依赖意图（用户显式勾选的完整前置，可能含被约简的冗余边）：持久化真相，写接口的唯一目标 */
  intent_prev_node_ids: string[];
  status: NodeStatus;
  /** 卡住说明（status='blocked' 时必填） */
  blocked_note: string | null;
  /** 完成时间（status='done' 时写入） */
  completed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** 节点的时间边界（供派生状态计算，见 node-status.ts） */
export interface NodeTimeRange {
  /** 区间起点时刻（所有前置完成时刻最晚值；无前置=项目最早完成时刻或今天） */
  start: Date | null;
  /** 区间终点时刻（自身 ddl；点状=当天 23:59） */
  end: Date | null;
}

export interface NodeDerivedState {
  status: DerivedStatus;
  /** 已超时文字（如「已超时 3 小时」「已超时 2 天」；非超时为空） */
  overdueLabel: string;
  /** 是否已超时（end < now 且非 done/blocked） */
  isOverdue: boolean;
  /** 完成时间 ISO（status='done' 时为 completed_at） */
  completedAt: string | null;
}

/** 评论类型：comment=普通评论，help=求助 */
export type CommentKind = 'comment' | 'help';

/** 节点评论 */
export interface NodeComment {
  id: string;
  authorName: string;
  content: string;
  kind: CommentKind;
  createdAt: string;
}

/** 个人任务聚合项（GET /api/me/nodes?name=xx） */
export interface MyNodeItem {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  nodeKind: NodeKind;
  ddl: string | null;
  pointDate: string | null;
  pointAllDay: boolean;
  pointStartTime: string | null;
  pointEndTime: string | null;
  assignees: string[];
  status: NodeStatus;
  blockedNote: string | null;
  completedAt: string | null;
  note: string;
  prevNodeIds: string[];
  derivedStatus: DerivedStatus;
  overdueLabel: string;
  commentCount: number;
  helpCount: number;
  lastCommentAt: string | null;
}

export const COMMENT_KIND: { value: CommentKind; label: string }[] = [
  { value: 'comment', label: '评论' },
  { value: 'help', label: '求助' },
];

/** 项目完整数据（供前端一次拉取） */
export interface ProjectDetail {
  project: Project;
  members: Member[];
  nodes: WorkflowNode[];
}

export const NODE_TYPES: { value: NodeType; label: string; desc: string }[] = [
  { value: 'linear', label: '普通', desc: '串行/分支，按前置顺序推进' },
  { value: 'converge', label: '汇聚', desc: '多个前置全部完成后可合并' },
];

/** 派生状态展示配置（看板列/卡片标签/流程图圆点） */
export const DERIVED_STATUSES: { value: DerivedStatus; label: string; dot: string; text: string; bg: string; border: string }[] = [
  { value: 'not_started', label: '未开始', dot: 'bg-slate-400', text: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
  { value: 'in_progress', label: '进行中', dot: 'bg-teal-500', text: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
  { value: 'ready', label: '可进行', dot: 'bg-teal-600', text: 'text-teal-700', bg: 'bg-teal-100/60', border: 'border-teal-300' },
  { value: 'overdue', label: '已超时', dot: 'bg-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
  { value: 'done', label: '已完成', dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { value: 'blocked', label: '卡住了', dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
];

export const DERIVED_STATUS_COLOR: Record<DerivedStatus, { dot: string; text: string; bg: string; border: string }> = {
  not_started: { dot: 'bg-slate-400', text: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
  in_progress: { dot: 'bg-teal-500', text: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
  ready: { dot: 'bg-teal-600', text: 'text-teal-700', bg: 'bg-teal-100/60', border: 'border-teal-300' },
  overdue: { dot: 'bg-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
  done: { dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  blocked: { dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
};

/** 节点存储状态操作选项（看板/详情弹窗状态菜单） */
export const STATUS_ACTIONS: { value: NodeStatus; label: string }[] = [
  { value: 'todo', label: '取消标记' },
  { value: 'done', label: '标记完成' },
  { value: 'blocked', label: '标记卡住了' },
];

export const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: 'hard', label: '硬' },
  { value: 'soft', label: '软' },
  { value: 'flexible', label: '弹性' },
];

export const TEMPLATES: { value: ProjectTemplate; label: string; desc: string; icon: string }[] = [
  { value: 'course_report', label: '课程汇报', desc: '选题 → 分工 → 整合 → 汇报', icon: 'presentation' },
  { value: 'experiment_report', label: '实验报告', desc: '设计 → 采集 → 分析 → 成稿', icon: 'flask' },
  { value: 'club_activity', label: '社团活动', desc: '策划 → 准备 → 执行 → 复盘', icon: 'sparkles' },
  { value: 'blank', label: '空白', desc: '从零开始自由搭建', icon: 'square' },
];