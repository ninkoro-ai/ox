import type {
  EquityRelation,
  EquityTree,
  PenetrateOptions,
  StopReason,
  TreeEdge,
  TreeNode,
} from '../types';
import { formatNum, formatRatio } from '../excel/ratio';
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
      // 穿透规则：仅对第一层中持股 ≥ 阈值（默认 25%）的股东生效。
      // 第一层达到阈值的股东启动控制链（deep），沿控制链持续向上穿透，
      // 直至自然人、境外公司或无明确持股比例为止；
      // 第二层起不再按自身持股比例单独触发穿透，仅在已处于控制链上时继续。
      const below = ratio === null ? true : ratio < opts.threshold;
      const deep = curNode.isTarget ? !below : cur.deep;
      const display = curNode.isTarget ? true : deep ? true : !below || opts.showBelowThreshold;
      if (!display) continue;

      const isPerson = opts.stopAtNaturalPerson && isLikelyNaturalPerson(investor, entityTypes[investor]);
      const isOverseas = opts.stopAtOverseas && isLikelyOverseas(investor, entityTypes[investor]);

      let reason: StopReason;
      if (isPerson) reason = 'natural-person';
      else if (isOverseas) reason = 'overseas';
      else if (ratio === null) reason = 'unknown-ratio';
      else if (!deep) reason = 'below-threshold';
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

  // —— 受益所有人识别：综合持股 = 自然人股东经全部持股路径对目标企业的持股之和 ——
  // 综合持股 > 阈值（默认 25%）的自然人即受益所有人；持股路径 ≤ 3 层时画出完整路径，
  // 超过 3 层时折叠为单个节点直接显示综合持股比例，避免深链影响图面可读性
  const aggMemo = new Map<string, number | null>();
  const aggregateOf = (id: string, visiting: Set<string>): number | null => {
    if (id === rootId) return 100;
    const cached = aggMemo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return null;
    visiting.add(id);
    let sum = 0;
    let anyKnown = false;
    for (const e of edges) {
      if (e.fromId !== id || e.ratio === null) continue;
      const parentAgg = aggregateOf(e.toId, visiting);
      if (parentAgg === null) continue;
      anyKnown = true;
      sum += (e.ratio * parentAgg) / 100;
    }
    visiting.delete(id);
    const result = anyKnown ? sum : null;
    aggMemo.set(id, result);
    return result;
  };

  const beneficialIds: string[] = [];
  for (const n of nodes) {
    if (n.stopReason !== 'natural-person') continue;
    const agg = aggregateOf(n.id, new Set());
    if (agg !== null && agg > opts.threshold) beneficialIds.push(n.id);
  }

  if (beneficialIds.length > 0) {
    const removed = new Set<string>();
    for (const pid of beneficialIds) {
      const p = nodeOf.get(pid)!;
      const agg = aggregateOf(pid, new Set())!;
      if (p.level <= 3) {
        warnings.push(`识别到受益所有人：${p.name}（综合持股${formatNum(agg, precision)}%）`);
        continue;
      }
      // 尝试安全折叠：路径各级均为单分支且未被共享
      const chain: TreeNode[] = [p];
      const onPath = new Set<string>([p.id]);
      let cur: TreeNode | undefined = p;
      let a3: TreeNode | undefined;
      let safe = true;
      while (cur && cur.level > 3) {
        const cn = cur as TreeNode;
        if (cn.children.some((cc) => !onPath.has(cc) && !removed.has(cc))) {
          safe = false;
          break;
        }
        const parents = edges.filter((e) => e.fromId === cn.id).map((e) => e.toId);
        if (parents.length !== 1) {
          safe = false;
          break;
        }
        const parent = nodeOf.get(parents[0])!;
        if (parent.level > 3) {
          if (parent.children.some((cc) => cc !== cn.id && !onPath.has(cc))) {
            safe = false;
            break;
          }
          chain.push(parent);
          onPath.add(parent.id);
          cur = parent;
        } else {
          a3 = parent;
          cur = undefined;
        }
      }
      if (!safe || !a3) {
        // 无法折叠时在自然人节点上直接标注综合持股比例
        p.name = `${p.name}（综合持股${formatNum(agg, precision)}%）`;
        p.ratioText = `综合${formatNum(agg, precision)}%`;
        warnings.push(`识别到受益所有人：${p.name}（持股路径超过三层，直接列示综合持股）`);
        continue;
      }
      // 折叠：删除 4 层及以上的整条链，替换为单个“自然人（综合持股X%）”节点
      for (const cn of chain) removed.add(cn.id);
      const collapsedId = `bo${counter++}`;
      const collapsed: TreeNode = {
        id: collapsedId,
        name: `${p.name}（综合持股${formatNum(agg, precision)}%）`,
        parentId: a3.id,
        level: a3.level + 1,
        ratio: agg,
        ratioText: `综合${formatNum(agg, precision)}%`,
        stopReason: 'natural-person',
        children: [],
        isTarget: false,
        isMerged: false,
        mergedCount: 1,
        mergedSum: null,
        regPlace: undefined,
      };
      nodes.push(collapsed);
      nodeOf.set(collapsedId, collapsed);
      a3.children = a3.children.filter((c) => !removed.has(c)).concat(collapsedId);
      edges.push({
        fromId: collapsedId,
        toId: a3.id,
        ratio: agg,
        label: `综合${formatNum(agg, precision)}%`,
      });
      warnings.push(`识别到受益所有人：${p.name}（综合持股${formatNum(agg, precision)}%，路径超过三层，折叠列示）`);
    }
    if (removed.size > 0) {
      nodes.splice(0, nodes.length, ...nodes.filter((n) => !removed.has(n.id)));
      edges.splice(
        0,
        edges.length,
        ...edges.filter((e) => !removed.has(e.fromId) && !removed.has(e.toId)),
      );
    }
  }

  return { targetName, nodes, edges, stats, warnings };
}
