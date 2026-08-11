import type {
  EquityRelation,
  EquityTree,
  PenetrateOptions,
  StopReason,
  TreeEdge,
  TreeNode,
} from '../types';
import { formatRatio } from '../excel/ratio';
import { inferRegPlace, isLikelyNaturalPerson, isLikelyOverseas } from './classify';

export function stopTag(): string | undefined {
  // 文本框内仅显示持股主体名称，不再显示自然人/境外等标签
  return undefined;
}

export function buildEquityTree(
  targetName: string,
  relations: EquityRelation[],
  entityTypes: Record<string, string>,
  opts: PenetrateOptions,
): EquityTree {
  const precision = opts.ratioPrecision ?? 2;
  const incoming = new Map<string, EquityRelation[]>();
  for (const r of relations) {
    if (!r.investor || !r.investee) continue;
    const list = incoming.get(r.investee);
    if (list) list.push(r);
    else incoming.set(r.investee, [r]);
  }
  for (const list of incoming.values()) {
    list.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  }

  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const nodeOf = new Map<string, TreeNode>();
  const nodeByName = new Map<string, string>(); // 主体名称 -> 节点 id（重复股东去重）
  const edgeKey = new Set<string>(); // "from\0to" 已建立的边
  let counter = 0;

  const rootId = `n${counter++}`;
  const root: TreeNode = {
    id: rootId,
    name: targetName,
    parentId: null,
    level: 0,
    ratio: null,
    ratioText: '—',
    stopReason: 'expanded',
    children: [],
    isTarget: true,
    isMerged: false,
    mergedCount: 1,
    mergedSum: null,
    regPlace: '中国',
  };
  nodes.push(root);
  nodeOf.set(rootId, root);
  nodeByName.set(targetName, rootId);

  const queue: Array<{ id: string; name: string; ancestors: Set<string>; deep: boolean }> = [
    { id: rootId, name: targetName, ancestors: new Set([targetName]), deep: false },
  ];

  let skippedByCycle = 0;
  let unknownCount = 0;

  while (queue.length) {
    const cur = queue.shift()!;
    const curNode = nodeOf.get(cur.id)!;
    const canExpand = curNode.stopReason === 'expanded' && curNode.level < opts.maxLevel;
    const children = canExpand ? (incoming.get(cur.name) ?? []) : [];
    const seenChild = new Set<string>();

    for (const rel of children) {
      const investor = rel.investor.trim();
      if (!investor || investor === '-' || investor === cur.name) continue;
      if (cur.ancestors.has(investor)) {
        skippedByCycle++;
        continue;
      }
      if (seenChild.has(investor)) continue;
      seenChild.add(investor);

      const ratio = rel.ratio;
      // 穿透规则：任一层的单一持股超过阈值（默认 25%）就继续向上穿透，
      // 超过 25% 的第一层直接股东形成的控制链，将一直向上穿透至境外公司或个人股东
      const below = ratio === null ? true : ratio <= opts.threshold;
      const deep = curNode.isTarget ? !below : cur.deep || !below;
      const display = curNode.isTarget ? true : deep ? true : !below || opts.showBelowThreshold;
      if (!display) continue;

      const isPerson = opts.stopAtNaturalPerson && isLikelyNaturalPerson(investor, entityTypes[investor]);
      const isOverseas = opts.stopAtOverseas && isLikelyOverseas(investor, entityTypes[investor]);

      let reason: StopReason;
      if (isPerson) reason = 'natural-person';
      else if (isOverseas) reason = 'overseas';
      else if (ratio === null) reason = 'unknown-ratio';
      else if (!deep && below) reason = 'below-threshold';
      else reason = 'expanded';

      const hasShareholders = (incoming.get(investor) ?? []).some(
        (r) => r.investor.trim() && r.investor.trim() !== investor && r.investor.trim() !== '-',
      );
      if (reason === 'expanded' && !hasShareholders) reason = 'no-shareholders';

      // 重复股东去重：同一主体只保留一个节点，补充完整持股路径（边）
      const existingId = nodeByName.get(investor);
      if (existingId) {
        const ex = nodeOf.get(existingId)!;
        const ek = `${existingId}\u0000${cur.id}`;
        if (edgeKey.has(ek)) continue;
        edgeKey.add(ek);
        if (!curNode.children.includes(existingId)) curNode.children.push(existingId);
        edges.push({ fromId: existingId, toId: cur.id, ratio, label: formatRatio(ratio, precision) });
        // 若该主体在新路径上应继续穿透而此前未展开，则补充展开
        if (ex.stopReason !== 'expanded' && reason === 'expanded' && ex.level < opts.maxLevel) {
          ex.stopReason = 'expanded';
          queue.push({ id: existingId, name: investor, ancestors: new Set([...cur.ancestors, investor]), deep });
        }
        if (ratio === null) unknownCount++;
        continue;
      }

      const childId = `n${counter++}`;
      const child: TreeNode = {
        id: childId,
        name: investor,
        parentId: cur.id,
        level: curNode.level + 1,
        ratio,
        ratioText: formatRatio(ratio, precision),
        stopReason: reason,
        children: [],
        isTarget: false,
        isMerged: false,
        mergedCount: 1,
        mergedSum: null,
        regPlace: isPerson ? undefined : inferRegPlace(investor, isOverseas),
      };
      nodes.push(child);
      nodeOf.set(childId, child);
      nodeByName.set(investor, childId);
      curNode.children.push(childId);
      edges.push({ fromId: childId, toId: cur.id, ratio, label: formatRatio(ratio, precision) });
      edgeKey.add(`${childId}\u0000${cur.id}`);

      if (ratio === null) unknownCount++;
      if (reason === 'expanded') {
        queue.push({ id: childId, name: investor, ancestors: new Set([...cur.ancestors, investor]), deep });
      }
    }
  }

  const stats = {
    totalRelations: relations.length,
    shownNodes: nodes.length,
    expandedNodes: 0,
    stoppedByPerson: 0,
    stoppedByOverseas: 0,
    stoppedByThreshold: 0,
    stoppedByUnknown: 0,
    maxLevel: 0,
  };
  for (const n of nodes) {
    if (n.stopReason === 'expanded') stats.expandedNodes++;
    else if (n.stopReason === 'natural-person') stats.stoppedByPerson++;
    else if (n.stopReason === 'overseas') stats.stoppedByOverseas++;
    else if (n.stopReason === 'below-threshold') stats.stoppedByThreshold++;
    else if (n.stopReason === 'unknown-ratio') stats.stoppedByUnknown++;
    if (n.level > stats.maxLevel) stats.maxLevel = n.level;
  }

  const warnings: string[] = [];
  if (unknownCount > 0) warnings.push(`存在 ${unknownCount} 条持股比例不详的股东关系，已按“未穿透”处理`);
  if (skippedByCycle > 0) warnings.push(`检测到 ${skippedByCycle} 条循环持股关系，已自动截断`);

  return { targetName, nodes, edges, stats, warnings };
}
