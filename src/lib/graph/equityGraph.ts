// 股权计算引擎：基于 Node + Edge 的 EquityGraph 模型
// 支撑未来能力：交叉持股、多路径持股、最终受益人计算、综合持股比例计算
import type { EquityGraph, EquityRelation, GraphEdge, GraphNode } from '../types';

/**
 * 由股权关系构建底层图模型：同一主体只保留一个节点，
 * 所有持股边（含多路径边）原样保留；自环忽略。
 */
export function buildEquityGraph(
  relations: EquityRelation[],
  entityTypes: Record<string, string> = {},
  targetName?: string,
): EquityGraph {
  const nodes: GraphNode[] = [];
  const byName = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const ensure = (name: string): GraphNode => {
    let n = byName.get(name);
    if (!n) {
      n = { id: `n${nodes.length}`, name, entityType: entityTypes[name] };
      nodes.push(n);
      byName.set(name, n);
    }
    return n;
  };
  if (targetName) ensure(targetName);
  for (const r of relations) {
    const investor = r.investor.trim();
    const investee = r.investee.trim();
    if (!investor || !investee || investor === '-') continue;
    const from = ensure(investor);
    const to = ensure(investee);
    if (from.id === to.id) continue;
    if (!from.entityType) from.entityType = r.investorType;
    edges.push({
      fromId: from.id,
      toId: to.id,
      ratio: r.ratio,
      remark: r.remark,
      source: r.sourceSheet,
    });
  }
  return { targetName: targetName ?? '', nodes, edges };
}

/** 入边邻接表：被投资方 -> 其全部投资方边（按持股比例降序） */
export function incomingEdgesOf(graph: EquityGraph): Map<string, GraphEdge[]> {
  const m = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = m.get(e.toId);
    if (list) list.push(e);
    else m.set(e.toId, [e]);
  }
  for (const list of m.values()) list.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  return m;
}

/** 出边邻接表：投资方 -> 其全部被投资方边 */
export function outgoingEdgesOf(graph: EquityGraph): Map<string, GraphEdge[]> {
  const m = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = m.get(e.fromId);
    if (list) list.push(e);
    else m.set(e.fromId, [e]);
  }
  return m;
}

/**
 * 综合持股比例（%）：节点经全部持股路径对目标企业的持股比例之和，
 * 单路径按“路径上各边比例之积”计算，多路径求和；循环路径自动截断。
 */
export function aggregateOwnership(
  graph: EquityGraph,
  nodeId: string,
  targetId: string,
): number | null {
  const memo = new Map<string, number | null>();
  const visit = (id: string, stack: Set<string>): number | null => {
    if (id === targetId) return 100;
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return null; // 环：该路径不计入
    stack.add(id);
    let sum = 0;
    let known = false;
    for (const e of graph.edges) {
      if (e.fromId !== id || e.ratio === null) continue;
      const parent = visit(e.toId, stack);
      if (parent === null) continue;
      known = true;
      sum += (e.ratio * parent) / 100;
    }
    stack.delete(id);
    const result = known ? sum : null;
    memo.set(id, result);
    return result;
  };
  return visit(nodeId, new Set());
}

/** 检测有向环（交叉持股），返回环路径（节点名称序列），供提示与后续算法使用 */
export function detectCycles(graph: EquityGraph): string[][] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const color = new Map<string, number>(); // 0 未访问 / 1 访问中 / 2 完成
  const cycles: string[][] = [];
  const stack: string[] = [];
  const dfs = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const e of graph.edges) {
      if (e.fromId !== id) continue;
      const c = color.get(e.toId) ?? 0;
      if (c === 1) {
        const idx = stack.indexOf(e.toId);
        if (idx >= 0) {
          cycles.push(stack.slice(idx).map((x) => byId.get(x)!.name).concat(byId.get(e.toId)!.name));
        }
      } else if (c === 0) {
        dfs(e.toId);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const n of graph.nodes) {
    if ((color.get(n.id) ?? 0) === 0) dfs(n.id);
  }
  return cycles;
}

/** 受益所有人：综合持股比例超过阈值的节点 */
export function findBeneficialOwners(
  graph: EquityGraph,
  targetId: string,
  threshold: number,
): Array<{ id: string; name: string; aggregate: number }> {
  const out: Array<{ id: string; name: string; aggregate: number }> = [];
  for (const n of graph.nodes) {
    if (n.id === targetId) continue;
    const agg = aggregateOwnership(graph, n.id, targetId);
    if (agg !== null && agg > threshold) out.push({ id: n.id, name: n.name, aggregate: agg });
  }
  return out;
}

/** 枚举 from → to 的全部持股路径（节点 id 序列），供多路径分析与展示 */
export function allPaths(graph: EquityGraph, fromId: string, toId: string, maxDepth = 20): string[][] {
  const out: string[][] = [];
  const dfs = (id: string, path: string[], seen: Set<string>): void => {
    if (path.length > maxDepth) return;
    if (id === toId) {
      out.push([...path]);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    for (const e of graph.edges) {
      if (e.fromId !== id) continue;
      path.push(e.toId);
      dfs(e.toId, path, seen);
      path.pop();
    }
    seen.delete(id);
  };
  dfs(fromId, [fromId], new Set());
  return out;
}
