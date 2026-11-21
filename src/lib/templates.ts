import type { WorkflowNode, ProjectTemplate, NodeType } from './types';

/**
 * 模板默认节点（组长创建项目时自动填充）。
 *
 * 依赖规则（显式前置索引 prevIndexes，构建时转为真实 id）：
 * - 指向模板数组下标：group=1 的资料收集/大纲撰写 都依赖 0 选题（分叉），
 *   汇聚节点 3 内容整合 依赖 1、2（合并），后面的节点依次线性推进。
 * - 不再依赖 parallel 类型参与构建依赖，避免"平行组"概念扩散。
 */
export interface TemplateNodeDef extends Omit<
  WorkflowNode,
  'id' | 'project_id' | 'created_at' | 'updated_at' | 'assignee' | 'ddl' | 'intent_prev_node_ids' | 'prev_node_ids'
> {
  /** 该节点依赖的模板节点下标（非 id，创建时转换为 prev_node_ids） */
  prevIndexes: number[];
}

interface Def {
  name: string;
  type: NodeType;
  status: 'todo';
  position: number;
  prevIndexes: number[];
}

function toDef(def: Def): TemplateNodeDef {
  return {
    name: def.name,
    type: def.type,
    assignees: [],
    strictness: 'soft',
    node_kind: 'ddl',
    point_date: null,
    point_all_day: true,
    point_start_time: null,
    point_end_time: null,
    note: '',
    status: def.status,
    blocked_note: null,
    completed_at: null,
    position: def.position,
    prevIndexes: def.prevIndexes,
  };
}

/** 生成模板默认节点（组长创建项目时自动填充） */
export function buildTemplateNodes(template: ProjectTemplate): TemplateNodeDef[] {
  switch (template) {
    case 'course_report':
      return [
        toDef({ name: '选题与分工', type: 'linear', status: 'todo', position: 0, prevIndexes: [] }),
        toDef({ name: '资料收集', type: 'linear', status: 'todo', position: 1, prevIndexes: [0] }),
        toDef({ name: '大纲撰写', type: 'linear', status: 'todo', position: 2, prevIndexes: [0] }),
        toDef({ name: '内容整合', type: 'converge', status: 'todo', position: 3, prevIndexes: [1, 2] }),
        toDef({ name: '排版与 PPT', type: 'linear', status: 'todo', position: 4, prevIndexes: [3] }),
        toDef({ name: '预演彩排', type: 'linear', status: 'todo', position: 5, prevIndexes: [4] }),
      ];
    case 'experiment_report':
      return [
        toDef({ name: '实验方案设计', type: 'linear', status: 'todo', position: 0, prevIndexes: [] }),
        toDef({ name: '文献阅读', type: 'linear', status: 'todo', position: 1, prevIndexes: [0] }),
        toDef({ name: '数据采集', type: 'linear', status: 'todo', position: 2, prevIndexes: [0] }),
        toDef({ name: '数据分析', type: 'converge', status: 'todo', position: 3, prevIndexes: [1, 2] }),
        toDef({ name: '报告撰写', type: 'linear', status: 'todo', position: 4, prevIndexes: [3] }),
        toDef({ name: '交叉校对', type: 'converge', status: 'todo', position: 5, prevIndexes: [4] }),
      ];
    case 'club_activity':
      return [
        toDef({ name: '活动策划', type: 'linear', status: 'todo', position: 0, prevIndexes: [] }),
        toDef({ name: '物资采购', type: 'linear', status: 'todo', position: 1, prevIndexes: [0] }),
        toDef({ name: '场地联络', type: 'linear', status: 'todo', position: 2, prevIndexes: [0] }),
        toDef({ name: '宣传物料', type: 'linear', status: 'todo', position: 3, prevIndexes: [0] }),
        toDef({ name: '现场执行', type: 'converge', status: 'todo', position: 4, prevIndexes: [1, 2, 3] }),
        toDef({ name: '活动复盘', type: 'linear', status: 'todo', position: 5, prevIndexes: [4] }),
      ];
    case 'blank':
    default:
      return [
        toDef({ name: '任务 1', type: 'linear', status: 'todo', position: 0, prevIndexes: [] }),
      ];
  }
}