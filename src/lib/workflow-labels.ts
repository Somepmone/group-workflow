import type { WorkflowNode } from './types';

/**
 * 按 DAG 依赖关系计算节点编号（纯整数，按拓扑序连续编号）。
 *
 * 规则：
 * - 遍历顺序 = 稳定拓扑序（前置总在后继之前；同层/同级按节点原始顺序，即服务端已按最新 DAG 重排后的 position）
 * - 编号从 1 开始，按遍历顺序依次分配 1、2、3…
 * - 不分叉点/后继/汇聚，全部统一为连续整数
 * - 编号连续、不跳号、不重复
 *
 * 示例：1 选题与分工 → 2 资料收集 / 3 大纲撰写 → 4 内容整合 → 5 排版与PPT → 6 预演彩排
 */
export function computeWorkflowLabels(nodes: WorkflowNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  if (nodes.length === 0) return labels;

  const validIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 稳定排序：按拓扑层级（最长路径）从左到右遍历；同一层内按 position（服务端已按最新 DAG 重排）稳定排序
  // 不依赖节点创建时间 / 数据库 ID；增删节点、修改前置后编号会按新拓扑结构全量重排
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>(); // 防环保护
  const depth = (id: string): number => {
    if (depthMemo.has(id)) return depthMemo.get(id) as number;
    if (visiting.has(id)) return 0;
    const node = byId.get(id);
    if (!node) return 0;
    visiting.add(id);
    const prevs = (node.prev_node_ids || []).filter((p) => validIds.has(p) && byId.has(p));
    const d = prevs.length > 0 ? 1 + Math.max(...prevs.map(depth)) : 0;
    visiting.delete(id);
    depthMemo.set(id, d);
    return d;
  };
  const order = [...nodes].sort(
    (a, b) => (depth(a.id) - depth(b.id)) || (a.position ?? 0) - (b.position ?? 0)
  );

  order.forEach((node, index) => {
    labels.set(node.id, String(index + 1));
  });

  return labels;
}