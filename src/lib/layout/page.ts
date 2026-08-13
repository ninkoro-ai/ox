import type { EquityTree, LayoutMode, LayoutResult, PageKey, PageMode, TreeEdge, TreeNode } from '../types';
import { formatNum } from '../excel/ratio';
import { attachRatioLabels, DEFAULT_LAYOUT_CONFIG, layoutTree } from './layout';

export const PAGES: Record<PageKey, { name: string; wIn: number; hIn: number }> = {
  a4: { name: 'A4 横向', wIn: 11.69, hIn: 8.27 },
  a3: { name: 'A3 横向', wIn: 16.535, hIn: 11.693 },
};

const MARGIN_X_IN = 0.55;
const MARGIN_TOP_IN = 1.15;
const MARGIN_BOTTOM_IN = 0.4;
const MAX_SCALE = 0.0165;
// 可读性下限：比例标签按 10px 设计字号换算，fontMinSize(默认 9pt) 对应 pxToIn = 9 / (10*72)
// 布局放不下时优先换行排列、自动升 A3，禁止通过无限缩小字体解决布局问题
const MIN_FONT_SCALE = 9 / 720;

function scaleFor(page: PageKey, layout: LayoutResult): number {
  const p = PAGES[page];
  const availW = p.wIn - MARGIN_X_IN * 2;
  const availH = p.hIn - MARGIN_TOP_IN - MARGIN_BOTTOM_IN;
  return Math.min(availW / layout.width, availH / layout.height);
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, s);
}

/** 版式解析：产品仅保留纵向银行授信版式（控股链垂直、境内外虚线齐全） */
function resolveLayoutMode(tree: EquityTree, mode?: LayoutMode): LayoutMode {
  if (mode && mode !== 'auto') return mode;
  return 'bank-ownership';
}

export interface FitOptions {
  pageMode: PageMode;
  mergeRatio: number;
  /** 合并起始层级：默认 2，即第一层（目标企业直接股东）不参与低比例合并，从第二层起生效 */
  mergeStartLevel?: number;
  /** 布局模式：bank-standard 突出控制链；minor-shareholders 低比例股东合并显示 */
  layoutMode?: LayoutMode;
  /** 每层最多展示的股东数量（默认 10）：超出部分归集为“其他持股不超X%”股东 */
  maxShareholdersPerLevel?: number;
  /** 是否启用每层股东数量上限归集（默认 true） */
  capShareholders?: boolean;
  /** 最小字号（pt）：默认 9，禁止无限缩小字体 */
  fontMinSize?: number;
  autoMerge: boolean;
  showRegPlace: boolean;
  mergeBelow: boolean; // 生成前按用户阈值归并低比例股东
  ratioPrecision: number; // 持股比例小数位
  textLayout?: 'horizontal' | 'vertical' | 'combo'; // 文本框方向：横向/纵向/横向+纵向组合
}

export interface FitResult {
  tree: EquityTree;
  layout: LayoutResult;
  page: PageKey;
  pxToIn: number;
  mergedGroups: number;
  warnings: string[];
}

function recomputeStats(nodes: TreeNode[], edges: TreeEdge[], totalRelations: number) {
  const stats = {
    totalRelations,
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
  return stats;
}

/** 低比例股东合并：把同一被投资企业下持股低于 mergeRatio 的叶子股东合并为一个“其他股东”节点 */
export function mergeLowRatio(
  tree: EquityTree,
  mergeRatio: number,
  precision = 2,
  mergeStartLevel = 2,
): { tree: EquityTree; merged: boolean; groups: number } {
  let groups = 0;
  const nodes: TreeNode[] = tree.nodes.map((n) => ({ ...n, children: [...n.children] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 记录每个节点的父节点（被投资企业）数量：共享主体（多路径）不参与归并，避免悬空引用
  const parentCount = new Map<string, number>();
  for (const n of nodes) {
    for (const c of n.children) parentCount.set(c, (parentCount.get(c) ?? 0) + 1);
  }
  const removed = new Set<string>();
  const createdMerged = new Set<string>();
  const collectSubtree = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    removed.add(id);
    for (const c of n.children) collectSubtree(c);
  };

  const originalIds = tree.nodes.map((n) => n.id);
  for (const id of originalIds) {
    const n = byId.get(id)!;
    if (removed.has(id)) continue;
    const kids = n.children
      .map((k) => byId.get(k))
      .filter((k): k is TreeNode => k !== undefined && !removed.has(k.id));
    const mergeable = kids.filter(
      (k) =>
        !k.isTarget &&
        k.stopReason !== 'merged' &&
        k.level >= mergeStartLevel &&
        (k.ratio === null || (k.ratio < mergeRatio && k.children.length === 0)) &&
        (parentCount.get(k.id) ?? 0) === 1,
    );
    if (mergeable.length < 2) continue;

    const keep = kids.filter((k) => !mergeable.includes(k));
    const knownSum = mergeable.reduce((s, k) => s + (k.ratio ?? 0), 0);
    const hasUnknown = mergeable.some((k) => k.ratio === null);
    const mId = `merged-${id}-${n.children.length}`;
    const mergedNode: TreeNode = {
      id: mId,
      name: `其他单一持股不超过${formatNum(mergeRatio, 0)}%的股东`,
      parentId: id,
      level: n.level + 1,
      ratio: hasUnknown ? null : knownSum,
      ratioText: hasUnknown
        ? `合计${formatNum(knownSum, precision)}%+`
        : `合计${formatNum(knownSum, precision)}%`,
      stopReason: 'merged',
      children: [],
      isTarget: false,
      isMerged: true,
      mergedCount: mergeable.length,
      mergedSum: knownSum,
    };
    nodes.push(mergedNode);
    byId.set(mId, mergedNode);
    createdMerged.add(mId);
    for (const k of mergeable) collectSubtree(k.id);
    n.children = [mId, ...keep.map((k) => k.id)];
    // 合并股东统一在最右侧，其余按持股比例从大到小（左→右）
    n.children.sort((a, b) => {
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      if (na.isMerged !== nb.isMerged) return na.isMerged ? 1 : -1;
      return (nb.ratio ?? -1) - (na.ratio ?? -1);
    });
    groups++;
  }

  const finalNodes = nodes.filter((n) => !removed.has(n.id));
  const finalIds = new Set(finalNodes.map((n) => n.id));
  const edges: TreeEdge[] = [];
  // 合并节点到其父节点的边
  for (const n of finalNodes) {
    if (createdMerged.has(n.id) && n.parentId && finalIds.has(n.parentId)) {
      edges.push({ fromId: n.id, toId: n.parentId, ratio: n.ratio, label: n.ratioText });
    }
  }
  // 保留原始边（含去重后共享主体的多路径边）
  for (const e of tree.edges) {
    if (finalIds.has(e.fromId) && finalIds.has(e.toId)) edges.push(e);
  }
  const merged = groups > 0;
  return {
    tree: {
      ...tree,
      nodes: finalNodes,
      edges,
      stats: recomputeStats(finalNodes, edges, tree.stats.totalRelations),
      warnings: merged ? [...tree.warnings, `已合并 ${groups} 组低比例股东`] : tree.warnings,
    },
    merged,
    groups,
  };
}

/**
 * 每层股东数量上限：对每一层（每个被投资企业）仅保留持股比例最大的前 maxN 名股东，
 * 其余股东归集为一个“其他持股不超X%的股东”节点，避免页面混乱。
 */
export function capTopShareholders(
  tree: EquityTree,
  maxN: number,
  precision = 2,
): { tree: EquityTree; merged: boolean; groups: number } {
  let groups = 0;
  const nodes: TreeNode[] = tree.nodes.map((n) => ({ ...n, children: [...n.children] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const removed = new Set<string>();
  const createdCapped = new Set<string>();
  const originalIds = tree.nodes.map((n) => n.id);
  for (const id of originalIds) {
    const n = byId.get(id)!;
    if (removed.has(id)) continue;
    const kids = n.children
      .map((k) => byId.get(k))
      .filter((k): k is TreeNode => k !== undefined && !removed.has(k.id));
    if (kids.length <= maxN) continue;
    // 按持股比例降序（比例不详排最后），保留前 maxN
    const sorted = [...kids].sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
    const keep = sorted.slice(0, maxN);
    const merged = sorted.slice(maxN);
    const knownMax = Math.max(0, ...merged.map((k) => k.ratio ?? 0));
    const knownSum = merged.reduce((s, k) => s + (k.ratio ?? 0), 0);
    const mId = `capped-${id}-${maxN}-${groups}`;
    const capNode: TreeNode = {
      id: mId,
      name: knownMax > 0 ? `其他持股不超${Math.ceil(knownMax)}%的股东` : '其他股东',
      parentId: id,
      level: n.level + 1,
      ratio: null,
      ratioText: `合计${formatNum(knownSum, precision)}%`,
      stopReason: 'merged',
      children: [],
      isTarget: false,
      isMerged: true,
      mergedCount: merged.length,
      mergedSum: knownSum,
      control: false,
    };
    nodes.push(capNode);
    byId.set(mId, capNode);
    createdCapped.add(mId);
    for (const k of merged) removed.add(k.id);
    n.children = [...keep.map((k) => k.id), mId];
    groups++;
  }
  const finalNodes = nodes.filter((n) => !removed.has(n.id));
  const finalIds = new Set(finalNodes.map((n) => n.id));
  const edges: TreeEdge[] = [];
  for (const n of finalNodes) {
    if (createdCapped.has(n.id) && n.parentId && finalIds.has(n.parentId)) {
      edges.push({ fromId: n.id, toId: n.parentId, ratio: n.ratio, label: n.ratioText });
    }
  }
  for (const e of tree.edges) {
    if (finalIds.has(e.fromId) && finalIds.has(e.toId)) edges.push(e);
  }
  const merged = groups > 0;
  return {
    tree: {
      ...tree,
      nodes: finalNodes,
      edges,
      stats: recomputeStats(finalNodes, edges, tree.stats.totalRelations),
      warnings: merged ? [...tree.warnings, `已按每层最多 ${maxN} 名股东归集其余股东`] : tree.warnings,
    },
    merged,
    groups,
  };
}

export function fitLayout(tree: EquityTree, opts: FitOptions): FitResult {
  let current = tree;
  let mergedGroups = 0;
  const warnings: string[] = [...tree.warnings];
  const minFontScale = (opts.fontMinSize ?? 9) / 720;
  const layoutMode = resolveLayoutMode(tree, opts.layoutMode);

  // 每层股东数量上限（默认开启）：仅保留前 maxShareholdersPerLevel 名，其余归集为“其他持股不超X%”股东
  const maxN = opts.maxShareholdersPerLevel ?? 10;
  if (opts.capShareholders !== false && maxN > 0) {
    const res = capTopShareholders(current, maxN, opts.ratioPrecision);
    if (res.merged) {
      current = res.tree;
      mergedGroups += res.groups;
    }
  }

  // 用户选项：生成前直接按阈值归并低比例股东；
  // 布局模式 minor-shareholders 同样强制低比例股东合并显示
  if (opts.mergeBelow || layoutMode === 'minor-shareholders') {
    const res = mergeLowRatio(current, opts.mergeRatio, opts.ratioPrecision, opts.mergeStartLevel ?? 2);
    if (res.merged) {
      current = res.tree;
      mergedGroups += res.groups;
    }
  }

  const tryPage = (
    t: EquityTree,
    textLayout: 'horizontal' | 'vertical' | 'combo' = 'horizontal',
  ): { page: PageKey; layout: LayoutResult; scale: number } | null => {
    const layout = layoutTree(t, {
      ...DEFAULT_LAYOUT_CONFIG,
      showRegPlace: opts.showRegPlace,
      textLayout,
      layoutMode,
    });
    if (opts.pageMode === 'auto') {
      // 根据节点数量自动选择：A4 放得下且可读（≥9pt）用 A4，否则升 A3；A3 仍不足则触发自动合并
      const sA4 = scaleFor('a4', layout);
      if (sA4 >= minFontScale) return { page: 'a4', layout, scale: sA4 };
      const sA3 = scaleFor('a3', layout);
      if (sA3 >= minFontScale) return { page: 'a3', layout, scale: sA3 };
      return null;
    }
    const s = scaleFor(opts.pageMode, layout);
    return { page: opts.pageMode, layout, scale: s };
  };

  let chosen: { page: PageKey; layout: LayoutResult; scale: number } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const hit = tryPage(current, opts.textLayout ?? 'horizontal');
    if (hit) {
      chosen = { page: hit.page, layout: hit.layout, scale: hit.scale };
      break;
    }
    if (!opts.autoMerge) break;
    const res = mergeLowRatio(current, opts.mergeRatio, opts.ratioPrecision, opts.mergeStartLevel ?? 2);
    if (!res.merged) break;
    current = res.tree;
    mergedGroups += res.groups;
  }

  if (!chosen) {
    const page: PageKey = opts.pageMode === 'auto' ? 'a3' : opts.pageMode;
    const layout = layoutTree(current, {
      ...DEFAULT_LAYOUT_CONFIG,
      showRegPlace: opts.showRegPlace,
      textLayout: opts.textLayout ?? 'horizontal',
      layoutMode,
    });
    chosen = { page, layout, scale: scaleFor(page, layout) };
  }

  // 比例标签：所有页面均在线两侧（左右交替/朝向被投资企业一侧），
  // 页面紧凑时由标签布局自动缩小字号并加大间距，确保不遮挡股权线
  const layout = attachRatioLabels(chosen.layout, 'both');
  const page = chosen.page;
  // 最终缩放：整图始终适配页面（优先 A4、空间不足自动 A3）；内容过密时按页面缩放并提示，
  // 不再通过强制 9pt 下限把内容挤出页面
  const fitScale = scaleFor(page, layout);
  const s = Math.min(clampScale(fitScale), fitScale);
  if (s < minFontScale) {
    warnings.push('内容较多，已按页面缩放完整放下，字号可能低于 9pt；建议开启“每层最多展示前N大股东”归集或减少股东数量');
  }
  return {
    tree: current,
    layout,
    page,
    pxToIn: s,
    mergedGroups,
    warnings,
  };
}
