import type { NodeType, WorkflowNode } from './types';

/**
 * 依据前置节点关系自动推断节点类型（纯函数，供服务端与客户端复用）。
 *
 * 规则：
 * - 汇聚(converge)：入度 >= 2（有多个前置节点）
 * - 普通(linear)：其他情况（入度 0 或 1）
 *
 * @param prevNodeIds 该节点的前置节点 id 列表（可能含失效 id，将自动过滤）
 * @param allNodes    项目内全部节点
 */
export function inferNodeType(prevNodeIds: string[], allNodes: WorkflowNode[]): NodeType {
  const validIds = new Set(allNodes.map((n) => n.id));
  const prevs = (prevNodeIds ?? []).filter((p) => validIds.has(p));
  if (prevs.length >= 2) return 'converge';
  return 'linear';
}

/**
 * 对一组节点重算类型，返回「需要更新」的节点 id → 新类型映射。
 * 不改变入参，不涉及数据库写入。
 */
export function recomputeNodeTypes(nodes: WorkflowNode[]): Map<string, NodeType> {
  const changes = new Map<string, NodeType>();
  for (const n of nodes) {
    const t = inferNodeType(n.prev_node_ids, nodes);
    if (t !== n.type) changes.set(n.id, t);
  }
  return changes;
}

/**
 * 基于依赖意图（intent）执行传递约简：把每个节点的 intent_prev_node_ids（完整声明）
 * 作为输入，输出「有效边」prev_node_ids 与本次被约简掉的冗余边。
 *
 * intent 是持久化真相：约简是派生视图。当替代路径被破坏时，原本冗余的边会自动恢复，
 * 因为每次都是从 intent 全集全量重算（而不是增量删边）。
 * 兼容旧数据：intent 缺失/为空时回退到 prev_node_ids。
 */
export function reduceIntents(nodes: WorkflowNode[]): ReductionResult {
  const withIntents: WorkflowNode[] = nodes.map((n) => ({
    ...n,
    prev_node_ids: Array.isArray(n.intent_prev_node_ids) ? n.intent_prev_node_ids : (n.prev_node_ids ?? []),
  }));
  const result = transitiveReduce(withIntents);
  // 保持每个节点自身的 intent 声明顺序返回有效边
  const prevNodeIdsByNode = new Map<string, string[]>();
  nodes.forEach((n) => {
    const kept = result.prevNodeIdsByNode.get(n.id) ?? [];
    // 按 intent 声明的顺序重排（保持用户勾选时的视觉顺序）
    const intentOrder = Array.isArray(n.intent_prev_node_ids) ? n.intent_prev_node_ids : (n.prev_node_ids ?? []);
    const orderIdx = new Map(intentOrder.map((p, i) => [p, i]));
    prevNodeIdsByNode.set(
      n.id,
      [...kept].sort((a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0))
    );
  });
  return { prevNodeIdsByNode, removedEdges: result.removedEdges };
}

/**
 * 循环依赖检测：若把 targetNodeId 的前置（intent）改为 newPrevIds，是否会形成环。
 * 环定义：target 成为自己的（直接或间接）前置，即 newPrevIds 中存在节点可沿
 * 其完整依赖链（intent）反向追溯到 targetNodeId，或 newPrevIds 直接包含 targetNodeId 自身。
 * 检测基准是 intent 全集，避免被约简后的有效边掩盖（用户勾了 A→B、B→A 必须被拒绝）。
 */
export function wouldCreateCycle(targetNodeId: string, newPrevIds: string[], allNodes: WorkflowNode[]): boolean {
  const validIds = new Set(allNodes.map((n) => n.id));
  const prevs = (newPrevIds ?? []).filter((p) => validIds.has(p));

  // 1) 直接包含自身
  if (prevs.includes(targetNodeId)) return true;

  // 2) BFS：从每个候选前置沿"它的完整依赖（intent）"向上反向追溯，遇到 targetNodeId 即成环
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const queue = [...prevs];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === targetNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = byId.get(current);
    if (!node) continue;
    const intents = Array.isArray(node.intent_prev_node_ids) ? node.intent_prev_node_ids : (node.prev_node_ids ?? []);
    for (const p of intents) {
      if (validIds.has(p)) queue.push(p);
    }
  }
  return false;
}

/** 被删除的冗余边（from=前置节点 id，to=节点 id） */
export interface RemovedEdge {
  from: string;
  to: string;
}

/** 传递约简结果 */
export interface ReductionResult {
  /** 节点 id -> 约简后的前置 id 列表（去重且有效） */
  prevNodeIdsByNode: Map<string, string[]>;
  /** 被判定为冗余、需要删除的边 */
  removedEdges: RemovedEdge[];
}

/**
 * 传递约简（Transitive Reduction）：删除所有冗余依赖边。
 *
 * 定义：若存在从 u 到 v 的不经过直接边 (u,v) 的替代路径，则 (u,v) 冗余。
 * 判定：在「完整图去掉该边」后，若 u 仍可达 v，则删除 (u,v)。
 * 保留后图与约简前图的传递闭包一致，但边数最少。
 */
export function transitiveReduce(nodes: WorkflowNode[]): ReductionResult {
  const validIds = new Set(nodes.map((n) => n.id));
  // 邻接表：from -> to 集合（有效 id，排除自环）
  const adj = new Map<string, Set<string>>();
  nodes.forEach((n) => adj.set(n.id, new Set<string>()));
  nodes.forEach((n) => {
    (n.prev_node_ids ?? []).forEach((p) => {
      if (validIds.has(p) && p !== n.id) adj.get(p)?.add(n.id);
    });
  });

  /** 在完整图中，跳过指定边 (skipFrom, skipTo)，判断 from 是否可达 to */
  function canReachWithoutEdge(from: string, to: string, skipFrom: string, skipTo: string): boolean {
    const queue = [from];
    const visited = new Set<string>([from]);
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const next of adj.get(cur) ?? []) {
        if (cur === skipFrom && next === skipTo) continue;
        if (next === to) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  const removed: RemovedEdge[] = [];
  nodes.forEach((toNode) => {
    const prevs = (toNode.prev_node_ids ?? []).filter((p) => validIds.has(p) && p !== toNode.id);
    prevs.forEach((from) => {
      if (canReachWithoutEdge(from, toNode.id, from, toNode.id)) {
        removed.push({ from, to: toNode.id });
      }
    });
  });

  // 应用删除结果
  const removedByTo = new Map<string, Set<string>>();
  removed.forEach((e) => {
    const set = removedByTo.get(e.to) ?? new Set<string>();
    set.add(e.from);
    removedByTo.set(e.to, set);
  });
  const prevNodeIdsByNode = new Map<string, string[]>();
  nodes.forEach((n) => {
    const removedFrom = removedByTo.get(n.id) ?? new Set<string>();
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const p of n.prev_node_ids ?? []) {
      if (!validIds.has(p) || p === n.id) continue;
      if (removedFrom.has(p)) continue;
      if (!seen.has(p)) {
        seen.add(p);
        kept.push(p);
      }
    }
    prevNodeIdsByNode.set(n.id, kept);
  });

  return { prevNodeIdsByNode, removedEdges: removed };
}

/**
 * 计算每个节点的拓扑层级（最长路径）。无前置=0，其他=max(前置层)+1。
 * 环数据按未分层(0)处理，避免死循环。
 */
export function computeLevelsMap(nodes: WorkflowNode[]): Map<string, number> {
  const validIds = new Set(nodes.map((n) => n.id));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id) as number;
    if (visiting.has(id)) return 0;
    const node = nodes.find((n) => n.id === id);
    if (!node) return 0;
    visiting.add(id);
    const prevs = (node.prev_node_ids ?? []).filter((p) => validIds.has(p) && p !== id);
    const d = prevs.length > 0 ? 1 + Math.max(...prevs.map(depth)) : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };

  const levels = new Map<string, number>();
  nodes.forEach((n) => levels.set(n.id, depth(n.id)));
  return levels;
}

/**
 * 按拓扑序重排 position：先按层级升序，同一层级内保持原有相对顺序（position 稳定）。
 * 返回「需要更新」的节点 id -> 新 position 映射（仅含变化项）。
 */
export function reorderByTopology(nodes: WorkflowNode[]): Map<string, number> {
  const levels = computeLevelsMap(nodes);
  const sorted = [...nodes].sort((a, b) => {
    const dl = (levels.get(a.id) ?? 0) - (levels.get(b.id) ?? 0);
    if (dl !== 0) return dl;
    return (a.position ?? 0) - (b.position ?? 0);
  });
  const changes = new Map<string, number>();
  sorted.forEach((n, i) => {
    if ((n.position ?? 0) !== i) changes.set(n.id, i);
  });
  return changes;
}

