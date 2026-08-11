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

/** 自动版式：简单股权结构（节点少、层级浅）用纵向银行授信版式（控股链垂直、境内外虚线齐全）；
 *  复杂结构用分带式布局，保证密集图可读且不重叠 */
function resolveLayoutMode(tree: EquityTree, mode?: LayoutMode): LayoutMode {
  if (mode && mode !== 'auto') return mode;
  const maxLevel = Math.max(0, ...tree.nodes.map((n) => n.level));
  const simple = tree.nodes.length <= 5 && maxLevel <= 2;
  return simple ? 'bank-ownership' : 'bank-standard';
}

export interface FitOptions {
  pageMode: PageMode;
  mergeRatio: number;
  /** 合并起始层级：默认 2，即第一层（目标企业直接股东）不参与低比例合并，从第二层起生效 */
  mergeStartLevel?: number;
  /** 布局模式：bank-standard 突出控制链；minor-shareholders 低比例股东合并显示 */
  layoutMode?: LayoutMode;
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
    if (n.isMerged && n.parentId && finalIds.has(n.parentId)) {
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

export function fitLayout(tree: EquityTree, opts: FitOptions): FitResult {
  let current = tree;
  let mergedGroups = 0;
  const warnings: string[] = [...tree.warnings];
  const minFontScale = (opts.fontMinSize ?? 9) / 720;
  const layoutMode = resolveLayoutMode(tree, opts.layoutMode);

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
  // 最终缩放：
  // - 常规模式：图表约占页面 4/5（线性约 89.4%），可读性优先——字号不得低于 fontMinSize；
  // - 银行授信版式：整图适配页面（优先 A4、空间不足自动 A3），放不下时按页面缩放并提示
  const fitScale = scaleFor(page, layout);
  const areaScale = Math.min(clampScale(fitScale) * 0.894, fitScale);
  const s =
    layoutMode === 'bank-ownership'
      ? Math.min(clampScale(fitScale), fitScale)
      : Math.max(areaScale, minFontScale);
  if (layoutMode === 'bank-ownership') {
    if (s < minFontScale) {
      warnings.push('银行授信版式内容较密集，已按页面缩放完整放下，字号可能低于 9pt；建议减少股东数量或切换其他版式');
    }
  } else if (fitScale < minFontScale) {
    warnings.push(`内容较多，图表在 ${page.toUpperCase()} 上无法按 ${opts.fontMinSize ?? 9}pt 字号完整放下；已保持最小字号，建议减少股东数量或开启低比例合并/拆分展示`);
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
