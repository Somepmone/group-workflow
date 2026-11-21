import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recomputeNodeTypes, reorderByTopology, reduceIntents, type RemovedEdge } from './node-types';
import type { WorkflowNode } from './types';

/** 拉取项目全部节点（按 position 升序） */
export async function fetchProjectNodes(projectId: string): Promise<WorkflowNode[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('nodes')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true });
  if (error) throw new Error(`查询节点失败: ${error.message}`);
  return (data ?? []) as WorkflowNode[];
}

export interface SyncWorkflowResult {
  /** 同步后的全量节点（prev_node_ids 已约简、position 已按拓扑序、类型已重算） */
  nodes: WorkflowNode[];
  /** 本次变更「新增」被约简的依赖边（from=前置节点 id，to=节点 id）：与变更前已简化的边做差集，
   *  供前端提示「本次被覆盖的边」，避免每次保存都重复提示历史简化 */
  removedEdges: RemovedEdge[];
}

/**
 * 全量同步工作流结构（增删改节点/前置后调用）。
 *
 * 双轨存储：
 * - intent_prev_node_ids（依赖意图）：用户显式勾选的完整前置，持久化真相，永不被约简。
 * - prev_node_ids（有效边）：派生视图，每次从 intent 全集重新计算传递约简得到。
 *
 * 关键：每次同步都从 intent 全量重算，因此当替代路径被破坏（中间节点被移除/取消依赖）时，
 * 原本冗余的边会自动恢复为有效边（"粘滞"特性）。
 *
 * 流程：
 * 1. 读 intent 全集 → 传递约简 → 得到有效边 prev_node_ids 并落库（仅变化行）
 * 2. 拓扑重排：按 DAG 层级重算全部 position，保证列表/编号/流程图顺序一致且稳定
 * 3. 类型重算：依据约简后的有效边重算全部节点类型并落库
 */
export async function syncWorkflow(projectId: string, previousRemovedEdges?: RemovedEdge[]): Promise<SyncWorkflowResult> {
  const client = getSupabaseClient();
  const nodes = await fetchProjectNodes(projectId);

  // 1. 基于 intent 全集做传递约简，重写 prev_node_ids（派生）
  const { prevNodeIdsByNode, removedEdges: allReducedEdges } = reduceIntents(nodes);
  // 增量语义：仅返回相对变更前「新增」的简化边（排除历史已简化的边）
  const removedEdges =
    Array.isArray(previousRemovedEdges) && previousRemovedEdges.length > 0
      ? allReducedEdges.filter(
          (e) => !previousRemovedEdges.some((p) => p.from === e.from && p.to === e.to)
        )
      : allReducedEdges;
  for (const node of nodes) {
    const nextPrevs = prevNodeIdsByNode.get(node.id) ?? [];
    const curPrevs = node.prev_node_ids ?? [];
    const isSame =
      nextPrevs.length === curPrevs.length && nextPrevs.every((p) => curPrevs.includes(p));
    if (isSame) continue;
    const { error } = await client
      .from('nodes')
      .update({ prev_node_ids: nextPrevs, updated_at: new Date().toISOString() })
      .eq('id', node.id);
    if (error) throw new Error(`同步依赖关系失败: ${error.message}`);
  }

  // 2. 拓扑重排：position 按层级稳定排序（基于新的有效边）
  let currentNodes = await fetchProjectNodes(projectId);
  const positionChanges = reorderByTopology(currentNodes);
  if (positionChanges.size > 0) {
    for (const [id, position] of positionChanges) {
      const { error } = await client
        .from('nodes')
        .update({ position, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(`重排节点顺序失败: ${error.message}`);
    }
    currentNodes = await fetchProjectNodes(projectId);
  }

  // 3. 类型重算：依据约简后的有效边
  const typeChanges = recomputeNodeTypes(currentNodes);
  if (typeChanges.size > 0) {
    for (const [id, type] of typeChanges) {
      const { error } = await client
        .from('nodes')
        .update({ type, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(`更新节点类型失败: ${error.message}`);
    }
    currentNodes = await fetchProjectNodes(projectId);
  }

  return { nodes: currentNodes, removedEdges };
}

/** 兼容旧调用：仅重算类型（现已包含约简+重排） */
export async function syncNodeTypes(projectId: string): Promise<WorkflowNode[]> {
  return (await syncWorkflow(projectId)).nodes;
}