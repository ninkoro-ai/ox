import type {
  EquityTree,
  LayoutBoundary,
  LayoutEdge,
  LayoutNode,
  LayoutResult,
  LayoutSegment,
  RatioLabel,
  RatioLabelSide,
  TreeNode,
} from '../types';
import { nodeSize, nodeSizeForWidth, ratioLabelSize } from './measure';
import { checkLayout, segIntersectsRectStrict } from './collision';

export interface LayoutConfig {
  hGap: number; // 兄弟子树水平间距
  rowGap: number; // 层级间距（放连线）
  margin: { top: number; bottom: number; left: number; right: number };
  showRegPlace?: boolean; // 是否在文本框内展示注册地
  zoneSplit?: boolean; // 境内外分区布局（境外在上、虚线分隔、境内在下）
  verticalNames?: boolean; // 横向放不下时：公司名称纵向排版（一字一行）压缩宽度
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  hGap: 20,
  rowGap: 64,
  margin: { top: 40, bottom: 40, left: 50, right: 50 },
  showRegPlace: true,
  zoneSplit: true,
  verticalNames: false,
};

export function layoutTree(
  tree: EquityTree,
  cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  depth = 0,
): LayoutResult {
  const showRegPlace = cfg.showRegPlace ?? true;
  const verticalNames = cfg.verticalNames ?? false;
  const regForSize = showRegPlace && !verticalNames;
  const root = tree.nodes.find((n) => n.isTarget);
  if (!root) throw new Error('树中缺少目标企业节点');

  const maxLevel = Math.max(0, ...tree.nodes.map((n) => n.level));
  const levelIds: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of tree.nodes) levelIds[n.level].push(n.id);

  // 主树：共享主体（去重后多路径）只归属首个父节点用于水平定位，
  // 其余路径作为补充边绘制完整持股路径
  const childrenOf = new Map<string, string[]>();
  const primaryParent = new Map<string, string>();
  for (const n of tree.nodes) {
    for (const c of n.children) {
      if (primaryParent.has(c)) continue;
      primaryParent.set(c, n.id);
      const list = childrenOf.get(n.id);
      if (list) list.push(c);
      else childrenOf.set(n.id, [c]);
    }
  }
  const nodeOf = new Map<string, TreeNode>(tree.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { w: number; h: number; lines: string[] }>();
  for (const n of tree.nodes) {
    sizes.set(n.id, nodeSize(n.name, regForSize ? n.regPlace : undefined, n.tag));
  }

  // 同一层股东等宽分布：以本层最大自然宽度统一文本框宽度，名称尽量显示在一行；
  // 高度统一为本层最大高度，保证同层文本框大小一致
  for (const ids of levelIds) {
    const targetW = verticalNames
      ? Math.min(Math.max(...ids.map((id) => sizes.get(id)!.w)), VERTICAL_NAME_W)
      : Math.max(...ids.map((id) => sizes.get(id)!.w));
    const remeasured = ids.map((id) => {
      const n = nodeOf.get(id)!;
      return nodeSizeForWidth(n.name, regForSize ? n.regPlace : undefined, n.tag, targetW);
    });
    const targetH = Math.max(...remeasured.map((s) => s.h));
    ids.forEach((id, i) => {
      sizes.set(id, { ...remeasured[i], h: Math.max(remeasured[i].h, targetH) });
    });
  }

  // 槽位布局（两遍）：
  // 第一遍自底向上计算每个节点的槽位宽度 = max(自身宽度, 子槽位总宽+间距)；
  // 第二遍自顶向下分配槽位起点，把父节点偏移正确传递给子节点，避免深层树向左塌陷
  const slot = new Map<string, { left: number; width: number }>();
  const widthOf = new Map<string, number>();
  const computeWidth = (id: string): number => {
    const cached = widthOf.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(id) ?? [];
    const w = sizes.get(id)!.w;
    if (kids.length === 0) {
      widthOf.set(id, w);
      return w;
    }
    const kidWidths = kids.map((k) => computeWidth(k));
    const total = kidWidths.reduce((a, b) => a + b, 0) + cfg.hGap * (kids.length - 1);
    const width = Math.max(w, total);
    widthOf.set(id, width);
    return width;
  };
  const rootSlotWidth = computeWidth(root.id);
  const assignLeft = (id: string, left: number) => {
    const kids = childrenOf.get(id) ?? [];
    const w = widthOf.get(id)!;
    slot.set(id, { left, width: w });
    if (kids.length === 0) return;
    const total = kids.reduce((a, k) => a + widthOf.get(k)!, 0) + cfg.hGap * (kids.length - 1);
    let cur = left + (w - total) / 2;
    for (const k of kids) {
      assignLeft(k, cur);
      cur += widthOf.get(k)! + cfg.hGap;
    }
  };
  assignLeft(root.id, 0);

  // 层级与行高
  const levelH = levelIds.map((ids) => Math.max(0, ...ids.map((id) => sizes.get(id)!.h)));

  // 自下而上：目标企业（level 0）在最底部，股东逐级向上
  const totalH = levelH.reduce((a, b) => a + b, 0) + cfg.rowGap * maxLevel;
  const yAbs: number[] = [];
  let top = totalH - levelH[0];
  yAbs.push(top);
  for (let l = 1; l <= maxLevel; l++) {
    top = top - cfg.rowGap - levelH[l];
    yAbs.push(top);
  }
  const shiftY = cfg.margin.top - Math.min(...yAbs);

  const layoutNodes: LayoutNode[] = [];
  for (const n of tree.nodes) {
    const s = slot.get(n.id)!;
    const size = sizes.get(n.id)!;
    const x = cfg.margin.left + s.left + s.width / 2 - size.w / 2;
    const y = yAbs[n.level] + shiftY;
    layoutNodes.push({
      id: n.id,
      name: n.name,
      level: n.level,
      x,
      y,
      w: size.w,
      h: size.h,
      lines: size.lines,
      ratioText: n.ratioText,
      stopReason: n.stopReason,
      tag: n.tag,
      regPlace: regForSize ? n.regPlace : undefined,
      isTarget: n.isTarget,
      isMerged: n.isMerged,
    });
  }


  // 境内/境外分区：境外股东一律位于虚线上方；当境外与境内节点同层或交错、
  // 无法自然画出分隔线时，把境外节点统一提升到顶部，境内节点在虚线下方按层排列
  const splitApplied = applyZoneSplit(layoutNodes, cfg);
  const nodeById = new Map(layoutNodes.map((n) => [n.id, n]));

  // 正交连线：投资方（上）→ 被投资企业（下），多股东汇聚为水平总线
  const segments: LayoutSegment[] = [];
  const nodeRects = layoutNodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  let laneCounter = 0;
  const nextLane = () => 12 + laneCounter++ * 10;
  const byTo = new Map<string, Array<{ fromId: string; ratio: number | null }>>();
  for (const e of tree.edges) {
    const list = byTo.get(e.toId);
    if (list) list.push({ fromId: e.fromId, ratio: e.ratio });
    else byTo.set(e.toId, [{ fromId: e.fromId, ratio: e.ratio }]);
  }

  for (const [toId, incoming] of byTo) {
    const to = nodeById.get(toId)!;
    const froms = incoming
      .map((e) => nodeById.get(e.fromId))
      .filter((n): n is LayoutNode => Boolean(n))
      .sort((a, b) => a.x - b.x);
    if (froms.length === 0) continue;

    if (froms.length === 1) {
      const f = froms[0];
      const sx = f.x + f.w / 2;
      const sy = f.y + f.h;
      if (
        crossesAny(sx, sy, sx, to.y, nodeRects)
      ) {
        // 直连会穿过其他文本框时（共享主体长距离边、境外股东等），从页面左侧绕行
        const laneX = nextLane();
        segments.push({ x1: sx, y1: sy, x2: sx, y2: sy + 4, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({ x1: sx, y1: sy + 4, x2: laneX, y2: sy + 4, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({ x1: laneX, y1: sy + 4, x2: laneX, y2: to.y - 14, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({ x1: laneX, y1: to.y - 14, x2: to.x + to.w / 2, y2: to.y - 14, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({
          x1: to.x + to.w / 2,
          y1: to.y - 14,
          x2: to.x + to.w / 2,
          y2: to.y,
          arrow: true,
          edgeId: f.id,
          kind: 'entry',
        });
        continue;
      }
      segments.push({
        x1: sx,
        y1: sy,
        x2: sx,
        y2: to.y,
        arrow: true,
        edgeId: f.id,
        kind: 'entry',
      });
      continue;
    }

    const gapTop = Math.max(...froms.map((f) => f.y + f.h));
    const gapBottom = to.y;
    // 总线贴近被投资企业上方，避免共享主体长距离边导致总线穿过中间行
    const busY = Math.min(gapTop + (gapBottom - gapTop) * 0.5, to.y - 24);
    let minX = Infinity;
    let maxX = -Infinity;
    froms.forEach((f) => {
      const sx = f.x + f.w / 2;
      const sy = f.y + f.h;
      if (crossesAny(sx, sy, sx, busY, nodeRects)) {
        // 向下会穿过其他文本框时（共享主体长距离边、境外股东等），从页面左侧绕行接入总线
        const laneX = nextLane();
        minX = Math.min(minX, laneX);
        segments.push({ x1: sx, y1: sy, x2: sx, y2: sy + 4, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({ x1: sx, y1: sy + 4, x2: laneX, y2: sy + 4, arrow: false, edgeId: f.id, kind: 'drop' });
        segments.push({ x1: laneX, y1: sy + 4, x2: laneX, y2: busY, arrow: false, edgeId: f.id, kind: 'drop' });
        return;
      }
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      segments.push({
        x1: sx,
        y1: sy,
        x2: sx,
        y2: busY,
        arrow: false,
        edgeId: f.id,
        kind: 'drop',
      });
    });
    // 各层级展示规范一致：多股东汇聚到任一被投资企业时，总线末端只保留一个箭头
    const cx = to.x + to.w / 2;
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    segments.push({
      x1: cx,
      y1: busY,
      x2: cx,
      y2: to.y,
      arrow: true,
      edgeId: to.id,
      kind: 'entry',
    });
    segments.push({
      x1: minX,
      y1: busY,
      x2: maxX,
      y2: busY,
      arrow: false,
      edgeId: toId,
      kind: 'bus',
    });
  }

  const width = cfg.margin.left + rootSlotWidth + cfg.margin.right;
  const height = Math.max(...layoutNodes.map((n) => n.y + n.h), cfg.margin.top) + cfg.margin.bottom;
  const edges: LayoutEdge[] = tree.edges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
    label: e.label,
  }));

  const layout: LayoutResult = {
    nodes: layoutNodes,
    segments,
    edges,
    labels: [],
    boundary: null,
    width,
    height,
  };

  // 安全网：正常情况下构造保证无重叠；若有问题则放大间距重排一次
  const report = checkLayout(layout);
  // 连线交叉在复杂多路径（共享主体）图中难以完全避免，不作为致命项；
  // 文本框重叠与连线穿框必须修复
  if (report.nodeOverlaps > 0 || report.segmentNodeHits > 0) {
    // 分区布局产生碰撞时退回原始布局；仍碰撞则放大间距重排
    if (splitApplied) {
      return layoutTree(tree, { ...cfg, zoneSplit: false }, depth + 1);
    }
    if (depth < 3) {
      return layoutTree(
        tree,
        {
          ...cfg,
          hGap: cfg.hGap + 30,
          rowGap: cfg.rowGap + 40,
        },
        depth + 1,
      );
    }
    return layout; // 尽力而为，避免无限重排
  }
  return layout;
}

function crossesAny(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
  return rects.some((r) => segIntersectsRectStrict(x1, y1, x2, y2, r));
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 境内/境外分区：当境外股东无法自然位于境内节点上方（同层或交错）时，
 * 将境外节点统一提升到顶部一行，境内节点在虚线下方按层纵向排列。
 */
function applyZoneSplit(nodes: LayoutNode[], cfg: LayoutConfig): boolean {
  const overseas = nodes.filter((n) => n.stopReason === 'overseas');
  const domestic = nodes.filter((n) => n.stopReason !== 'overseas');
  if (overseas.length === 0 || domestic.length === 0 || cfg.zoneSplit === false) return false;

  const overseasBottom = Math.max(...overseas.map((n) => n.y + n.h));
  const domesticTop = Math.min(...domestic.map((n) => n.y));
  // 已能自然画出分隔线（境外全部在上且空间足够）时无需调整
  if (overseasBottom + BOUNDARY_MIN_PAD + BOUNDARY_LABEL_H + 8 <= domesticTop) return false;

  // 境外股东统一提升到顶部一行
  const ovTop = Math.min(...overseas.map((n) => n.y));
  const ovMaxH = Math.max(...overseas.map((n) => n.h));
  for (const n of overseas) {
    n.y = ovTop;
    n.h = ovMaxH;
  }
  const ovBottom = ovTop + ovMaxH;
  const boundaryY = Math.max(ovBottom + BOUNDARY_PAD, ovBottom + BOUNDARY_MIN_PAD);

  // 境内节点在虚线下方按层纵向排列（层号大者在上，目标企业 level 0 在最下）
  const levels = [...new Set(domestic.map((n) => n.level))].sort((a, b) => b - a);
  const levelH = new Map<number, number>();
  for (const L of levels) {
    levelH.set(L, Math.max(...domestic.filter((n) => n.level === L).map((n) => n.h)));
  }
  let cursor = boundaryY + BOUNDARY_LABEL_H + 10;
  const yOf = new Map<number, number>();
  for (const L of levels) {
    yOf.set(L, cursor);
    cursor += cfg.rowGap + levelH.get(L)!;
  }
  for (const n of domestic) n.y = yOf.get(n.level)!;
  return true;
}

export type RatioLabelSideMode = 'both' | 'right';

const LABEL_GAP = 6; // 比例标签与连接线的水平间距
const VERTICAL_NAME_W = 34; // 纵向排版时文本框宽度（约一个字宽）
const BOUNDARY_PAD = 26; // 分隔线与境外节点底部的间距（含“境外”标签）
const BOUNDARY_MIN_PAD = 16; // 境外节点底部到虚线的最小间距
const BOUNDARY_LABEL_H = 14; // “境外/境内”标签高度

/**
 * 在连线旁附加持股比例标签，并计算境内/境外分隔虚线。
 * - sideMode 'both'：同一被投资企业的股东按左右交替放置；
 * - sideMode 'right'：页面紧凑时统一放在连接线右侧。
 */
export function attachRatioLabels(
  layout: LayoutResult,
  sideMode: RatioLabelSideMode = 'both',
): LayoutResult {
  const nodes = layout.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 境内/境外分隔虚线：仅当境外节点全部位于境内节点上方时绘制
  const overseas = nodes.filter((n) => n.stopReason === 'overseas');
  const domestic = nodes.filter((n) => n.stopReason !== 'overseas');
  let boundary: LayoutBoundary | null = null;
  if (overseas.length > 0 && domestic.length > 0) {
    const overseasBottom = Math.max(...overseas.map((n) => n.y + n.h));
    const domesticTop = Math.min(...domestic.map((n) => n.y));
    // 下方需留出“境内”标签（BOUNDARY_LABEL_H）与间距
    if (overseasBottom + BOUNDARY_MIN_PAD + BOUNDARY_LABEL_H + 8 <= domesticTop) {
      const y = Math.min(
        overseasBottom + BOUNDARY_PAD,
        domesticTop - BOUNDARY_LABEL_H - 10,
      );
      const yClamped = Math.max(y, overseasBottom + BOUNDARY_MIN_PAD);
      const x1 = Math.min(...nodes.map((n) => n.x));
      const x2 = Math.max(...nodes.map((n) => n.x + n.w));
      boundary = { y: yClamped, x1, x2 };
    }
  }

  const byTo = new Map<string, Array<{ fromId: string; text: string }>>();
  for (const e of layout.edges) {
    const list = byTo.get(e.toId);
    if (list) list.push({ fromId: e.fromId, text: e.label });
    else byTo.set(e.toId, [{ fromId: e.fromId, text: e.label }]);
  }

  const labels: RatioLabel[] = [];
  for (const [toId, incoming] of byTo) {
    const to = byId.get(toId);
    if (!to) continue;
    const ordered = incoming
      .map((e) => {
        const from = byId.get(e.fromId);
        return from ? { ...e, from } : null;
      })
      .filter((e): e is { fromId: string; text: string; from: LayoutNode } => e !== null)
      .sort((a, b) => a.from.x - b.from.x);

    ordered.forEach((e, i) => {
      const text = e.text;
      if (!text || text === '—' || text === '不详') return;
      const candidates = layout.segments.filter(
        (s) => (s.kind === 'drop' || s.kind === 'entry') && s.edgeId === e.fromId,
      );
      if (candidates.length === 0) return;
      const seg = candidates.reduce((best, s) =>
        Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1) >
        Math.abs(best.x2 - best.x1) + Math.abs(best.y2 - best.y1)
          ? s
          : best,
      );

      let anchorY = (seg.y1 + seg.y2) / 2;
      // 跨越境内外分隔线的边：标签放到分隔线下方，避免与虚线重叠
      if (boundary && seg.y1 < boundary.y && seg.y2 > boundary.y) {
        anchorY = Math.min(boundary.y + 12, seg.y2 - 10);
      }
      const size = ratioLabelSize(text);
      const preferred: RatioLabelSide = sideMode === 'right' ? 'right' : i % 2 === 0 ? 'left' : 'right';
      // 候选位置：优先同侧，必要时加大间距/上下偏移/换到另一侧，避免与连线或文本框重合
      const placements: Array<{ side: RatioLabelSide; dy: number; gap: number }> =
        sideMode === 'right'
          ? [
              { side: 'right', dy: 0, gap: LABEL_GAP },
              { side: 'right', dy: 0, gap: LABEL_GAP + 10 },
              { side: 'right', dy: -10, gap: LABEL_GAP },
              { side: 'right', dy: 10, gap: LABEL_GAP },
              { side: 'right', dy: -20, gap: LABEL_GAP },
              { side: 'right', dy: 20, gap: LABEL_GAP },
            ]
          : [
              { side: preferred, dy: 0, gap: LABEL_GAP },
              { side: preferred, dy: 0, gap: LABEL_GAP + 10 },
              { side: preferred, dy: -10, gap: LABEL_GAP },
              { side: preferred, dy: 10, gap: LABEL_GAP },
              { side: preferred === 'left' ? 'right' : 'left', dy: 0, gap: LABEL_GAP },
              { side: preferred === 'left' ? 'right' : 'left', dy: 0, gap: LABEL_GAP + 10 },
              { side: preferred, dy: -20, gap: LABEL_GAP },
              { side: preferred, dy: 20, gap: LABEL_GAP },
            ];
      let chosen: { x: number; y: number; side: RatioLabelSide } | null = null;
      for (const c of placements) {
        const cx = c.side === 'left' ? seg.x1 - c.gap - size.w : seg.x1 + c.gap;
        const cy = anchorY + c.dy - size.h / 2;
        const rect = { x: cx, y: cy, w: size.w, h: size.h };
        const hitNode = layout.nodes.some((n) => rectsOverlap(rect, { x: n.x, y: n.y, w: n.w, h: n.h }));
        const hitSeg = layout.segments.some((s) => segIntersectsRectStrict(s.x1, s.y1, s.x2, s.y2, rect));
        const hitLabel = labels.some((l) => rectsOverlap(rect, { x: l.x, y: l.y, w: l.w, h: l.h }));
        if (!hitNode && !hitSeg && !hitLabel) {
          chosen = { x: cx, y: cy, side: c.side };
          break;
        }
      }
      if (!chosen) {
        chosen = {
          x: preferred === 'left' ? seg.x1 - LABEL_GAP - size.w : seg.x1 + LABEL_GAP,
          y: anchorY - size.h / 2,
          side: preferred,
        };
      }
      labels.push({
        edgeId: e.fromId,
        text,
        x: chosen.x,
        y: chosen.y,
        w: size.w,
        h: size.h,
        side: chosen.side,
        anchorX: seg.x1,
        anchorY,
      });
    });
  }

  // 把标签与分隔线纳入画布边界，避免被页面裁切
  const margin = DEFAULT_LAYOUT_CONFIG.margin;
  const minX = Math.min(...nodes.map((n) => n.x), ...labels.map((l) => l.x), boundary?.x1 ?? Infinity);
  const maxX = Math.max(
    ...nodes.map((n) => n.x + n.w),
    ...labels.map((l) => l.x + l.w),
    boundary?.x2 ?? -Infinity,
  );
  const minY = Math.min(
    ...nodes.map((n) => n.y),
    ...labels.map((l) => l.y),
    boundary ? boundary.y - BOUNDARY_LABEL_H - 2 : Infinity,
  );
  const maxY = Math.max(
    ...nodes.map((n) => n.y + n.h),
    ...labels.map((l) => l.y + l.h),
    boundary ? boundary.y + BOUNDARY_LABEL_H : -Infinity,
  );

  const dx = minX < margin.left ? margin.left - minX : 0;
  const dy = minY < margin.top ? margin.top - minY : 0;
  if (dx !== 0 || dy !== 0) {
    for (const n of nodes) {
      n.x += dx;
      n.y += dy;
    }
    for (const s of layout.segments) {
      s.x1 += dx;
      s.x2 += dx;
      s.y1 += dy;
      s.y2 += dy;
    }
    for (const l of labels) {
      l.x += dx;
      l.y += dy;
      l.anchorX += dx;
      l.anchorY += dy;
    }
    if (boundary) {
      boundary.x1 += dx;
      boundary.x2 += dx;
      boundary.y += dy;
    }
  }

  layout.width = Math.max(maxX + dx + margin.right, layout.width);
  layout.height = Math.max(maxY + dy + margin.bottom, layout.height);
  layout.labels = labels;
  layout.boundary = boundary;
  return layout;
}
