/**
 * 同层节点垂直排序（重心法 barycenter + 交叉数优化）
 *
 * 目标：减少 DAG 分层布局中箭头的交叉。
 * 做法：
 * 1. 按拓扑层级（最长路径）分层；
 * 2. 自上而下 + 自下而上交替迭代：每层节点的垂直位置 = 所有相邻层关联节点的平均位置（重心）；
 * 3. 局部优化：对每层反复尝试交换相邻两个节点，若全图交叉数减少则保留；
 * 4. 渲染时按该顺序垂直排列同层节点，连线用贝塞尔曲线尽量避开节点。
 */

export interface BaryNode {
  id: string;
  position: number;
  prev_node_ids: string[];
}

/** 计算拓扑层级（最长路径）：无前置=0，其他=max(前置层)+1 */
export function baryLevels(nodes: BaryNode[]): Map<string, number> {
  const validIds = new Set(nodes.map((n) => n.id));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id) as number;
    if (visiting.has(id)) return 0;
    const node = byId.get(id);
    if (!node) return 0;
    visiting.add(id);
    const prevs = (node.prev_node_ids || []).filter((p) => validIds.has(p) && p !== id);
    const d = prevs.length > 0 ? 1 + Math.max(...prevs.map(depth)) : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };

  const levels = new Map<string, number>();
  nodes.forEach((n) => levels.set(n.id, depth(n.id)));
  return levels;
}

/** 统计两层之间的交叉数（layerA 在上层，layerB 在下层，边 direction: layerA -> layerB） */
export function countCrossings(
  layerA: string[],
  layerB: string[],
  getPrevs: (id: string) => string[]
): number {
  if (layerA.length === 0 || layerB.length === 0) return 0;
  const posA = new Map(layerA.map((id, i) => [id, i]));
  const posB = new Map(layerB.map((id, i) => [id, i]));
  // 收集 A->B 的边
  const edges: Array<[number, number]> = [];
  layerA.forEach((a) => {
    posA.get(a);
    getPrevs(a).forEach((p) => {
      if (posB.has(p)) edges.push([posA.get(a) as number, posB.get(p) as number]);
    });
  });
  // 边按 A 侧位置排序，统计 B 侧逆序数 = 交叉数
  edges.sort((e1, e2) => e1[0] - e2[0]);
  let crossing = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edges[j][0] > edges[i][0] && edges[j][1] < edges[i][1]) crossing++;
    }
  }
  return crossing;
}

/** 计算全图总交叉数（所有相邻层对之和） */
export function totalCrossings(
  orders: string[][],
  getPrevs: (id: string) => string[]
): number {
  let total = 0;
  for (let l = 0; l + 1 < orders.length; l++) {
    total += countCrossings(orders[l], orders[l + 1], getPrevs);
  }
  return total;
}

/**
 * 重心法排序：返回每层节点 id 的垂直顺序（升序 = 从上到下）。
 * @param nodes 全部节点
 * @param maxSweep 骨架迭代轮数（默认 8）
 */
export function orderByBarycenter(nodes: BaryNode[]): string[][] {
  if (nodes.length === 0) return [];
  const levels = baryLevels(nodes);
  const validIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 按层级分组，层内初始顺序 = position 升序（保持稳定，不依赖创建时间/ID）
  const maxLevel = Math.max(...nodes.map((n) => levels.get(n.id) ?? 0), 0);
  const orders: string[][] = [];
  for (let l = 0; l <= maxLevel; l++) {
    const layerNodes = nodes.filter((n) => (levels.get(n.id) ?? 0) === l).sort((a, b) => a.position - b.position);
    orders.push(layerNodes.map((n) => n.id));
  }

  const posOf = (order: string[]): Map<string, number> => new Map(order.map((id, i) => [id, i]));

  // 自顶向下 + 自底向上交替迭代（重心法）
  for (let iter = 0; iter < 8; iter++) {
    // 自顶向下：按「前置节点在其层中的平均位置」排序
    for (let l = 1; l <= maxLevel; l++) {
      const prevPos = posOf(orders[l - 1]);
      const weighted = orders[l].map((id) => {
        const node = byId.get(id);
        const prevs = (node?.prev_node_ids || []).filter((p) => validIds.has(p) && prevPos.has(p));
        if (prevs.length === 0) return { id, value: Infinity }; // 无前置的节点保持靠后（稳定）
        const value = prevs.reduce((s, p) => s + (prevPos.get(p) as number), 0) / prevs.length;
        return { id, value };
      });
      // 稳定排序：value 相同保持原相对顺序
      const sorted = [...weighted]
        .map((w, idx) => ({ ...w, idx }))
        .sort((a, b) => (a.value !== b.value ? a.value - b.value : a.idx - b.idx));
      orders[l] = sorted.map((w) => w.id);
    }
    // 自底向上：按「后继节点在其层中的平均位置」排序
    for (let l = maxLevel - 1; l >= 0; l--) {
      const nextPos = posOf(orders[l + 1]);
      // 预计算每层节点的后继
      const succByNode = new Map<string, string[]>();
      orders[l + 1].forEach((childId) => {
        const child = byId.get(childId);
        for (const p of child?.prev_node_ids || []) {
          if (validIds.has(p)) {
            const list = succByNode.get(p) ?? [];
            list.push(childId);
            succByNode.set(p, list);
          }
        }
      });
      const weighted = orders[l].map((id) => {
        const succs = (succByNode.get(id) || []).filter((s) => nextPos.has(s));
        if (succs.length === 0) return { id, value: Infinity };
        const value = succs.reduce((s, c) => s + (nextPos.get(c) as number), 0) / succs.length;
        return { id, value };
      });
      const sorted = [...weighted]
        .map((w, idx) => ({ ...w, idx }))
        .sort((a, b) => (a.value !== b.value ? a.value - b.value : a.idx - b.idx));
      orders[l] = sorted.map((w) => w.id);
    }
  }

  // 局部优化：贪心交换相邻节点减小总交叉数（限制轮数避免震荡）
  const getPrevs = (id: string): string[] => (byId.get(id)?.prev_node_ids || []).filter((p) => validIds.has(p));
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let l = 0; l <= maxLevel; l++) {
      if (orders[l].length < 2) continue;
      for (let i = 0; i + 1 < orders[l].length; i++) {
        const before = totalCrossings(orders, getPrevs);
        // 交换相邻两个节点
        const swapped = orders[l].slice();
        [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
        const nextOrders = orders.map((o, ol) => (ol === l ? swapped : o));
        const after = totalCrossings(nextOrders, getPrevs);
        if (after < before) {
          orders[l] = swapped;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return orders;
}