import type { EquityTree, LayoutResult, PageKey, PageMode, TreeEdge, TreeNode } from '../types';
import { formatNum } from '../excel/ratio';
import { attachRatioLabels, DEFAULT_LAYOUT_CONFIG, layoutTree } from './layout';

export const PAGES: Record<PageKey, { name: string; wIn: number; hIn: number }> = {
  '16x9': { name: '16:9', wIn: 13.333, hIn: 7.5 },
  a4: { name: 'A4 横向', wIn: 11.69, hIn: 8.27 },
  a3: { name: 'A3 横向', wIn: 16.535, hIn: 11.693 },
};

const MARGIN_X_IN = 0.55;
const MARGIN_TOP_IN = 1.15;
const MARGIN_BOTTOM_IN = 0.4;
// pxToIn 单位：英寸/像素。名称字号 13px 对应 pt = 13 * pxToIn * 72，
// 因此 0.0085 ≈ 8pt，是最低可读字号
const MIN_GOOD_16X9 = 0.0085;
// 等宽文本框后 A4 版面可容纳约 7.7pt 字号
const MIN_GOOD_A4 = 0.0082;
const MIN_GOOD_A3 = 0.0075;
const MIN_MANUAL = 0.007;
const MIN_ALLOWED = 0.0045;
// 简单结构不放大铺满整页：名称 13px 最多约 14pt，图表保持“约半张 A4”的紧凑尺寸
const MAX_SCALE = 0.015;

function scaleFor(page: PageKey, layout: LayoutResult): number {
  const p = PAGES[page];
  const availW = p.wIn - MARGIN_X_IN * 2;
  const availH = p.hIn - MARGIN_TOP_IN - MARGIN_BOTTOM_IN;
  return Math.min(availW / layout.width, availH / layout.height);
}

function clampScale(s: number): number {
  return Math.max(MIN_ALLOWED, Math.min(MAX_SCALE, s));
}

export interface FitOptions {
  pageMode: PageMode;
  mergeRatio: number;
  autoMerge: boolean;
  showRegPlace: boolean;
  mergeBelow: boolean; // 生成前按用户阈值归并低比例股东
  ratioPrecision: number; // 持股比例小数位
  verticalText?: boolean; // 文本框文字方向：true=纵向（一字一行），默认横向
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
): { tree: EquityTree; merged: boolean; groups: number } {
  let groups = 0;
  const nodes: TreeNode[] = tree.nodes.map((n) => ({ ...n, children: [...n.children] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
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
      (k) => !k.isTarget && (k.ratio === null || (k.ratio < mergeRatio && k.children.length === 0)),
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

  // 用户选项：生成前直接按阈值归并低比例股东
  if (opts.mergeBelow) {
    const res = mergeLowRatio(current, opts.mergeRatio, opts.ratioPrecision);
    if (res.merged) {
      current = res.tree;
      mergedGroups += res.groups;
    }
  }

  const tryPage = (
    t: EquityTree,
    verticalNames = false,
  ): { page: PageKey; layout: LayoutResult; scale: number } | null => {
    const layout = layoutTree(t, {
      ...DEFAULT_LAYOUT_CONFIG,
      showRegPlace: opts.showRegPlace,
      verticalNames,
    });
    if (opts.pageMode === 'auto') {
      // 简单结构优先 A4（约半张 A4 的紧凑版面），放不下再依次尝试 16:9、A3
      for (const page of ['a4', '16x9', 'a3'] as PageKey[]) {
        const s = scaleFor(page, layout);
        const min = page === 'a4' ? MIN_GOOD_A4 : page === '16x9' ? MIN_GOOD_16X9 : MIN_GOOD_A3;
        if (s >= min) return { page, layout, scale: s };
      }
      return null;
    }
    const s = scaleFor(opts.pageMode, layout);
    return s >= MIN_MANUAL ? { page: opts.pageMode, layout, scale: s } : null;
  };

  let chosen: { page: PageKey; layout: LayoutResult; scale: number } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const hit = tryPage(current, opts.verticalText ?? false);
    if (hit) {
      chosen = { page: hit.page, layout: hit.layout, scale: hit.scale };
      break;
    }
    if (!opts.autoMerge) break;
    const res = mergeLowRatio(current, opts.mergeRatio, opts.ratioPrecision);
    if (!res.merged) break;
    current = res.tree;
    mergedGroups += res.groups;
  }

  if (!chosen) {
    const page: PageKey = opts.pageMode === 'auto' ? 'a3' : opts.pageMode;
    const layout = layoutTree(current, {
      ...DEFAULT_LAYOUT_CONFIG,
      showRegPlace: opts.showRegPlace,
      verticalNames: opts.verticalText ?? false,
    });
    chosen = { page, layout, scale: scaleFor(page, layout) };
  }

  // 比例标签：A4（紧凑）统一右侧，16:9 / A3 左右交替
  const layout = attachRatioLabels(chosen.layout, chosen.page === 'a4' ? 'right' : 'both');
  const page = chosen.page;
  // 最终缩放：可读时按上限放大，放不下时绝不超出页面范围
  const fitScale = scaleFor(page, layout);
  const s = Math.min(clampScale(fitScale), fitScale);
  if (fitScale < MIN_ALLOWED) {
    warnings.push('内容较多，图表已按最小可读尺寸缩放；建议切换纵向文本框或调低合并阈值/拆分展示');
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
