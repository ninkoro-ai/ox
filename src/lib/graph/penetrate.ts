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

const STOP_TAGS: Record<string, string> = {
  'natural-person': '自然人',
  overseas: '境外',
  'below-threshold': '未穿透',
  'unknown-ratio': '股比不详',
  'no-shareholders': '无股东信息',
  'max-level': '已达层级上限',
  merged: '合并股东',
};

export function stopTag(reason: StopReason, threshold: number): string | undefined {
  if (reason === 'expanded') return undefined;
  // 未穿透状态不显示在文本框内，持股比例已在连接线旁展示
  if (reason === 'below-threshold') return undefined;
  return STOP_TAGS[reason];
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

  const queue: Array<{ id: string; name: string; level: number; ancestors: Set<string> }> = [
    { id: rootId, name: targetName, level: 0, ancestors: new Set([targetName]) },
  ];

  let skippedByCycle = 0;
  let unknownCount = 0;

  while (queue.length) {
    const cur = queue.shift()!;
    const curNode = nodeOf.get(cur.id)!;
    const canExpand = curNode.stopReason === 'expanded' && cur.level < opts.maxLevel;
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
      const below = ratio === null ? true : ratio < opts.threshold;
      const display = curNode.isTarget ? true : !below || opts.showBelowThreshold;
      if (!display) continue;

      const isPerson = opts.stopAtNaturalPerson && isLikelyNaturalPerson(investor, entityTypes[investor]);
      const isOverseas = opts.stopAtOverseas && isLikelyOverseas(investor, entityTypes[investor]);

      let reason: StopReason;
      if (isPerson) reason = 'natural-person';
      else if (isOverseas) reason = 'overseas';
      else if (ratio === null) reason = 'unknown-ratio';
      else if (ratio < opts.threshold) reason = 'below-threshold';
      else reason = 'expanded';

      const hasShareholders = (incoming.get(investor) ?? []).some(
        (r) => r.investor.trim() && r.investor.trim() !== investor && r.investor.trim() !== '-',
      );
      if (reason === 'expanded' && !hasShareholders) reason = 'no-shareholders';

      const childId = `n${counter++}`;
      const child: TreeNode = {
        id: childId,
        name: investor,
        parentId: cur.id,
        level: cur.level + 1,
        ratio,
        ratioText: formatRatio(ratio, precision),
        stopReason: reason,
        tag: stopTag(reason, opts.threshold),
        children: [],
        isTarget: false,
      isMerged: false,
      mergedCount: 1,
      mergedSum: null,
      regPlace: isPerson ? undefined : inferRegPlace(investor, isOverseas),
    };
      nodes.push(child);
      nodeOf.set(childId, child);
      curNode.children.push(childId);
      edges.push({ fromId: childId, toId: cur.id, ratio, label: formatRatio(ratio, precision) });

      if (ratio === null) unknownCount++;
      if (reason === 'expanded') {
        queue.push({
          id: childId,
          name: investor,
          level: cur.level + 1,
          ancestors: new Set([...cur.ancestors, investor]),
        });
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
