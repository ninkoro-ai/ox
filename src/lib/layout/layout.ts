import type {
  EquityEdge,
  EquityTree,
  LayoutBoundary,
  LayoutMode,
  LayoutNode,
  LayoutResult,
  LayoutSegment,
  RatioLabel,
  RatioLabelSide,
  TreeEdge,
  TreeNode,
} from '../types';
import { nodeSize, nodeSizeForWidth, ratioLabelSize } from './measure';
import {
  checkLayout,
  findSegmentCollinearOverlaps,
  findSegmentCrossings,
  segIntersectsRectStrict,
} from './collision';
import { EDGE_CROSS_COLORS } from '../theme';

export interface LayoutConfig {
  hGap: number; // 兄弟子树水平间距
  rowGap: number; // 层级间距（放连线）
  margin: { top: number; bottom: number; left: number; right: number };
  showRegPlace?: boolean; // 是否在文本框内展示注册地
  zoneSplit?: boolean; // 境内外分区布局（境外在上、虚线分隔、境内在下）
  textLayout?: 'horizontal' | 'vertical' | 'combo'; // 文本框方向：横向/纵向/横向+纵向组合
  layoutMode?: LayoutMode; // 布局模式：bank-ownership 为银行授信版式（纵向树、独立连线）
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  hGap: 14,
  rowGap: 64,
  margin: { top: 40, bottom: 40, left: 40, right: 40 },
  showRegPlace: true,
  zoneSplit: true,
  textLayout: 'horizontal',
};

export function layoutTree(
  tree: EquityTree,
  cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  depth = 0,
): LayoutResult {
  // 银行授信版式：目标公司固定底部中央、控股链保持纵向、每个投资关系独立连接（无汇流总线）
  if (cfg.layoutMode === 'bank-ownership') {
    return layoutBankOwnership(tree, cfg, depth);
  }
  const showRegPlace = cfg.showRegPlace ?? true;
  const textLayout = cfg.textLayout ?? 'horizontal';
  const levelCount = (level: number) => levelIds[level]?.length ?? 0;
  // 纵向排版：用户选择“纵向”时全部纵向；组合模式下股东较多且持股 <5% 的股东纵向
  const vertOf = (n: TreeNode) =>
    textLayout === 'vertical' ||
    (textLayout === 'combo' && levelCount(n.level) >= MANY_SHAREHOLDERS && n.ratio !== null && n.ratio < SMALL_RATIO);
  const regOf = (n: TreeNode) => (showRegPlace && !vertOf(n) ? n.regPlace : undefined);
  const root = tree.nodes.find((n) => n.isTarget);
  if (!root) throw new Error('树中缺少目标企业节点');

  const maxLevel = Math.max(0, ...tree.nodes.map((n) => n.level));
  const levelIds: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of tree.nodes) levelIds[n.level].push(n.id);

  const nodeOf = new Map<string, TreeNode>(tree.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { w: number; h: number; lines: string[] }>();
  for (const n of tree.nodes) {
    sizes.set(n.id, nodeSize(n.name, regOf(n), n.tag));
  }

  // 文字方向规则：
  // - 用户选择纵向：整层纵向（一字一行，窄文本框）
  // - 股东数量较多（>= 7）且存在持股 <5% 的股东：混合模式——小股东纵向、其余横向
  // - 默认横向：节点宽高按公司名称长度动态计算（不再强制同层等宽）
  for (const ids of levelIds) {
    const many = ids.length >= MANY_SHAREHOLDERS;
    const hasSmall = ids.some((id) => {
      const r = nodeOf.get(id)!.ratio;
      return r !== null && r < SMALL_RATIO;
    });
    const combo = textLayout === 'combo' && many && hasSmall;
    if (textLayout === 'vertical') {
      const targetW = Math.min(Math.max(...ids.map((id) => sizes.get(id)!.w)), VERTICAL_NAME_W);
      const remeasured = ids.map((id) => {
        const n = nodeOf.get(id)!;
        return nodeSizeForWidth(n.name, undefined, n.tag, targetW);
      });
      const targetH = Math.max(...remeasured.map((s) => s.h));
      ids.forEach((id, i) => {
        sizes.set(id, { ...remeasured[i], h: Math.max(remeasured[i].h, targetH) });
      });
    } else if (combo) {
      // 混合模式：持股 < 5% 的股东纵向排版，其余保留横向自然尺寸
      for (const id of ids) {
        const n = nodeOf.get(id)!;
        if (n.ratio !== null && n.ratio < SMALL_RATIO) {
          sizes.set(id, nodeSizeForWidth(n.name, undefined, n.tag, VERTICAL_NAME_W));
        }
      }
    }
    // 默认横向：保持动态尺寸
  }

  // 银行报告式分层布局：每层为一个横向“带”，同一层节点横向排列；
  // 同一层节点超过 MAX_PER_ROW（默认 5）个时自动换行（每行最多 5 个，行号 0 起）
  const rowOf = new Map<string, number>();
  const levelRowsList = levelIds.map((ids) => {
    const rows: string[][] = [];
    for (let i = 0; i < ids.length; i += MAX_PER_ROW) rows.push(ids.slice(i, i + MAX_PER_ROW));
    rows.forEach((r, ri) => r.forEach((k) => rowOf.set(k, ri)));
    return rows;
  });
  const levelRowW = levelRowsList.map((rows) =>
    Math.max(
      0,
      ...rows.map((r) => r.reduce((a, k) => a + sizes.get(k)!.w, 0) + cfg.hGap * (r.length - 1)),
    ),
  );
  const overallW = Math.max(0, ...levelRowW);
  const xOf = new Map<string, number>(); // 节点 -> 相对 margin.left 的左边距
  levelRowsList.forEach((rows) => {
    for (const r of rows) {
      const rw = r.reduce((a, k) => a + sizes.get(k)!.w, 0) + cfg.hGap * (r.length - 1);
      let cur = (overallW - rw) / 2;
      for (const k of r) {
        xOf.set(k, cur);
        cur += sizes.get(k)!.w + cfg.hGap;
      }
    }
  });

  // 层级与行高：每层由若干行组成（同层超过 5 个股东时换行）
  const levelRowH = levelIds.map((ids) => Math.max(0, ...ids.map((id) => sizes.get(id)!.h)));
  const levelRows = levelRowsList.map((rows) => rows.length);
  const levelH = levelIds.map((_, L) =>
    levelRows[L] > 0 ? levelRows[L] * levelRowH[L] + (levelRows[L] - 1) * ROW_GAP : 0,
  );

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
    const size = sizes.get(n.id)!;
    const x = cfg.margin.left + xOf.get(n.id)!;
    const y = yAbs[n.level] + (rowOf.get(n.id) ?? 0) * (levelRowH[n.level] + ROW_GAP) + shiftY;
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
      regPlace: regOf(n),
      isTarget: n.isTarget,
      isMerged: n.isMerged,
      control: n.control ?? false,
      row: rowOf.get(n.id),
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
  // 车道一律放在左侧留白内（margin.left=40），避免进入文本框区域
  const nextLane = () => Math.min(8 + laneCounter++ * 8, 34);
  const byTo = new Map<string, Array<{ fromId: string; ratio: number | null }>>();
  for (const e of tree.edges) {
    const list = byTo.get(e.toId);
    if (list) list.push({ fromId: e.fromId, ratio: e.ratio });
    else byTo.set(e.toId, [{ fromId: e.fromId, ratio: e.ratio }]);
  }
  // 同一股东有多条出资线时，各条线从文本框底部略微错开，避免竖直段重叠
  const outCount = new Map<string, number>();
  for (const list of byTo.values()) {
    const seen = new Set<string>();
    for (const e of list) {
      if (seen.has(e.fromId)) continue;
      seen.add(e.fromId);
      outCount.set(e.fromId, (outCount.get(e.fromId) ?? 0) + 1);
    }
  }
  const outUsed = new Map<string, number>();
  const dropX = (f: LayoutNode): number => {
    const total = outCount.get(f.id) ?? 1;
    const used = outUsed.get(f.id) ?? 0;
    outUsed.set(f.id, used + 1);
    if (total <= 1) return f.x + f.w / 2;
    return f.x + f.w / 2 + (used - (total - 1) / 2) * 7;
  };

  // 通用车道路径：投资方在上时从底边引出、进入被投资企业顶边；
  // 同层/逆向补充边时从顶边引出（先进入上方空隙），统一进入被投资企业顶边，
  // 避免竖直段穿过文本框
  const routeLanePath = (f: LayoutNode, to: LayoutNode, laneX: number): void => {
    pushLanePath(segments, f, to, laneX, dropX(f));
  };

  for (const [toId, incoming] of byTo) {
    const to = nodeById.get(toId)!;
    const froms = incoming
      .map((e) => nodeById.get(e.fromId))
      .filter((n): n is LayoutNode => Boolean(n))
      .sort((a, b) => a.x - b.x);
    if (froms.length === 0) continue;

    // 换行布局中位于第 1 行及以下的股东，其竖直引出线会穿过上一行文本框，必须走左侧车道
    const needsLane = (f: LayoutNode, targetY: number): boolean =>
      (f.row ?? 0) > 0 || crossesAny(dropX(f), f.y + f.h, dropX(f), targetY, nodeRects);

    if (froms.length === 1) {
      const f = froms[0];
      if (f.y + f.h > to.y + 1) {
        // 同层/逆向补充边：走独立车道，不参与总线
        routeLanePath(f, to, nextLane());
        continue;
      }
      const sx = dropX(f);
      const sy = f.y + f.h;
      // 直连仅当引出线不与任何文本框相交且落点在被投资企业上边沿内时使用；
      // 否则走左侧车道，保证箭头明确指向被投资企业
      if (
        needsLane(f, to.y) ||
        sx < to.x + 1 ||
        sx > to.x + to.w - 1
      ) {
        // 直连会穿过其他文本框时（共享主体长距离边、境外股东等），从页面左侧绕行
        const laneX = nextLane();
        segments.push({ x1: sx, y1: sy, x2: sx, y2: sy + 4, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({ x1: sx, y1: sy + 4, x2: laneX, y2: sy + 4, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({ x1: laneX, y1: sy + 4, x2: laneX, y2: to.y - 14, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({ x1: laneX, y1: to.y - 14, x2: to.x + to.w / 2, y2: to.y - 14, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({
          x1: to.x + to.w / 2,
          y1: to.y - 14,
          x2: to.x + to.w / 2,
          y2: to.y,
          arrow: true,
          edgeId: f.id,
          toId: to.id,
          kind: 'entry',
          control: f.control,
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
        toId: to.id,
        kind: 'entry',
        control: f.control,
      });
      continue;
    }

    const gapTop = Math.max(...froms.map((f) => f.y + f.h));
    const gapBottom = to.y;
    // 总线贴近被投资企业上方，避免共享主体长距离边导致总线穿过中间行
    const busY = Math.min(gapTop + (gapBottom - gapTop) * 0.5, to.y - 24);
    let minX = Infinity;
    let maxX = -Infinity;
    const laneFroms: LayoutNode[] = [];
    const invertedFroms: LayoutNode[] = [];
    froms.forEach((f) => {
      if (f.y + f.h > to.y + 1) {
        invertedFroms.push(f);
        return;
      }
      const sx = dropX(f);
      const sy = f.y + f.h;
      if (needsLane(f, busY)) {
        // 换行第 1 行及以下或直连穿框的股东：先到左侧共享车道，再接入总线
        laneFroms.push(f);
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
        toId: to.id,
        kind: 'drop',
        control: f.control,
      });
    });
    for (const f of invertedFroms) {
      // 同层/逆向补充边各自走独立车道（不参与总线，避免方向冲突）
      routeLanePath(f, to, nextLane());
    }
    if (laneFroms.length > 0) {
      // 同一被投资企业的所有换行股东共享一条车道：车道从最上方引出点直通总线
      const laneX = nextLane();
      const laneTop = Math.min(...laneFroms.map((f) => f.y + f.h));
      for (const f of laneFroms) {
        const sx = dropX(f);
        const sy = f.y + f.h;
        segments.push({ x1: sx, y1: sy, x2: sx, y2: sy + 4, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({ x1: sx, y1: sy + 4, x2: laneX, y2: sy + 4, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
      }
      segments.push({
        x1: laneX,
        y1: laneTop,
        x2: laneX,
        y2: busY,
        arrow: false,
        edgeId: toId,
        toId: to.id,
        kind: 'drop',
        control: to.control ?? false,
      });
      minX = Math.min(minX, laneX);
    }
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
      toId: to.id,
      kind: 'entry',
      control: to.control ?? false,
    });
    segments.push({
      x1: minX,
      y1: busY,
      x2: maxX,
      y2: busY,
      arrow: false,
      edgeId: toId,
      toId: to.id,
      kind: 'bus',
      control: to.control ?? false,
    });
  }

  const width = cfg.margin.left + overallW + cfg.margin.right;
  const height = Math.max(...layoutNodes.map((n) => n.y + n.h), cfg.margin.top) + cfg.margin.bottom;
  // 布局阶段的股权关系边：携带 ratio 与 label，labelPosition 由 attachRatioLabels 填充
  const edges: EquityEdge[] = tree.edges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
    ratio: e.ratio,
    label: e.label,
    control: nodeOf.get(e.fromId)?.control ?? false,
  }));

  // 连接路径归属到 Edge：渲染器只遍历 Edge 及其 path 绘制连线。
  // 多股东汇聚时，总线与入口箭头只挂在“主边”（持股比例最大的股东边）上，
  // 其余股东边只保留各自的引出线段（落点与总线相接）。
  const primaryOf = new Map<string, string>();
  for (const [toId, incoming] of byTo) {
    const best = incoming.slice().sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))[0];
    if (best) primaryOf.set(toId, best.fromId);
  }
  for (const e of edges) {
    e.path = segments.filter(
      (s) =>
        s.toId === e.toId &&
        (s.edgeId === e.fromId ||
          (s.edgeId === e.toId && primaryOf.get(e.toId) === e.fromId)),
    );
  }

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

/**
 * 银行授信版式（BankOwnershipLayout）：
 * - 纵向股权结构：股东在上、被投资公司在下方，目标公司固定在最底部中央；
 * - 第一层直接股东在目标公司上方水平展开；
 * - 多层穿透保持纵向：控股链（自然人 → 控股公司 → 目标公司）始终在同一列，不横向展开；
 * - 同层股东按持股比例降序排列，最大股东靠近中心控制链，小股东向两侧展开；
 * - 每个投资关系独立连接（禁止大范围横向汇流线），持股比例绑定 Edge；
 * - 页面优先 A4 横向，空间不足自动切换 A3（由 fitLayout 统一处理）。
 */
export function layoutBankOwnership(
  tree: EquityTree,
  cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  depth = 0,
): LayoutResult {
  const showRegPlace = cfg.showRegPlace ?? true;
  const textLayout = cfg.textLayout ?? 'horizontal';
  const nodeOf = new Map<string, TreeNode>(tree.nodes.map((n) => [n.id, n]));
  const maxLevel = Math.max(0, ...tree.nodes.map((n) => n.level));
  const levelIds: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of tree.nodes) levelIds[n.level].push(n.id);

  // 节点尺寸：按名称长度动态计算；纵向模式一字一行
  const vertOf = (n: TreeNode) => textLayout === 'vertical';
  const regOf = (n: TreeNode) => (showRegPlace && !vertOf(n) ? n.regPlace : undefined);
  const sizes = new Map<string, { w: number; h: number; lines: string[] }>();
  for (const n of tree.nodes) sizes.set(n.id, nodeSize(n.name, regOf(n), n.tag));
  if (textLayout === 'vertical') {
    for (const ids of levelIds) {
      const targetW = Math.min(Math.max(...ids.map((id) => sizes.get(id)!.w)), VERTICAL_NAME_W);
      const remeasured = ids.map((id) => {
        const n = nodeOf.get(id)!;
        return nodeSizeForWidth(n.name, undefined, n.tag, targetW);
      });
      const targetH = Math.max(...remeasured.map((s) => s.h));
      ids.forEach((id, i) => {
        sizes.set(id, { ...remeasured[i], h: Math.max(remeasured[i].h, targetH) });
      });
    }
  }

  // 股东（上方）分组：被投资企业 -> 其股东边（持股比例降序）
  const parentsOf = new Map<string, TreeEdge[]>();
  for (const e of tree.edges) {
    const list = parentsOf.get(e.toId);
    if (list) list.push(e);
    else parentsOf.set(e.toId, [e]);
  }
  for (const list of parentsOf.values()) {
    list.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || a.fromId.localeCompare(b.fromId));
  }

  // 同层节点数量控制：同一被投资企业的股东超过 MAX_PER_ROW（默认 5）个时自动换行，
  // 每行最多 5 个（行 0 最靠近被投资企业），避免整行过宽导致文本框被压到不可读
  const parentRowsOf = new Map<string, string[][]>(); // 被投资企业 -> 股东行（每行 fromId 列表）
  const rowOfParent = new Map<string, Map<string, number>>(); // 被投资企业 -> (股东 fromId -> 行号)
  for (const n of tree.nodes) {
    const parents = parentsOf.get(n.id) ?? [];
    const rows: string[][] = [];
    for (let i = 0; i < parents.length; i += MAX_PER_ROW) {
      rows.push(parents.slice(i, i + MAX_PER_ROW).map((p) => p.fromId));
    }
    parentRowsOf.set(n.id, rows);
    const rowIdx = new Map<string, number>();
    rows.forEach((r, ri) => r.forEach((p) => rowIdx.set(p, ri)));
    rowOfParent.set(n.id, rowIdx);
  }

  // 槽位宽度：列宽向上递归（父节点各行最大行宽），保证控股链纵向对齐
  const widthOf = new Map<string, number>();
  const computeW = (id: string): number => {
    const cached = widthOf.get(id);
    if (cached !== undefined) return cached;
    const rows = parentRowsOf.get(id) ?? [];
    const w = sizes.get(id)!.w;
    if (rows.length === 0) {
      widthOf.set(id, w);
      return w;
    }
    let groupW = 0;
    for (const r of rows) {
      const rw = r.reduce((a, p) => a + computeW(p), 0) + cfg.hGap * (r.length - 1);
      groupW = Math.max(groupW, rw);
    }
    const width = Math.max(w, groupW);
    widthOf.set(id, width);
    return width;
  };
  const target = tree.nodes.find((n) => n.isTarget)!;
  const totalW = computeW(target.id);

  // 定位：目标底部中央，股东逐级向上；同层股东最大者居中、其余按比例降序左右交替展开
  const slot = new Map<string, { left: number; width: number }>();
  const arrange = (id: string, left: number, width: number) => {
    slot.set(id, { left, width });
    const rows = parentRowsOf.get(id) ?? [];
    if (rows.length === 0) return;
    const center = left + width / 2;
    for (const row of rows) {
      const rw = row.reduce((a, p) => a + widthOf.get(p)!, 0) + cfg.hGap * (row.length - 1);
      const pos = new Map<string, number>();
      pos.set(row[0], center - widthOf.get(row[0])! / 2);
      let rightEdge = center + widthOf.get(row[0])! / 2 + cfg.hGap;
      let leftEdge = center - widthOf.get(row[0])! / 2 - cfg.hGap;
      for (let i = 1; i < row.length; i++) {
        const p = row[i];
        const pw = widthOf.get(p)!;
        if (i % 2 === 1) {
          pos.set(p, rightEdge);
          rightEdge += pw + cfg.hGap;
        } else {
          pos.set(p, leftEdge - pw);
          leftEdge -= pw + cfg.hGap;
        }
      }
      for (const p of row) arrange(p, pos.get(p)!, widthOf.get(p)!);
    }
  };
  arrange(target.id, 0, totalW);

  // 纵向位置：从目标（底部）开始，股东行逐级向上堆叠（行 0 最靠近被投资企业）
  const yOf = new Map<string, number>();
  const placeY = (id: string, y: number): void => {
    const prev = yOf.get(id);
    if (prev === undefined || y < prev) yOf.set(id, y);
    const rows = parentRowsOf.get(id) ?? [];
    if (rows.length === 0) return;
    const rowH = rows.map((r) => Math.max(...r.map((p) => sizes.get(p)!.h)));
    let cursor = y - cfg.rowGap;
    rows.forEach((r, ri) => {
      cursor -= rowH[ri];
      for (const p of r) placeY(p, cursor);
      cursor -= ROW_GAP;
    });
  };
  placeY(target.id, 0);
  const shiftY = cfg.margin.top - Math.min(...yOf.values());

  const layoutNodes: LayoutNode[] = [];
  for (const n of tree.nodes) {
    const s = slot.get(n.id)!;
    const size = sizes.get(n.id)!;
    const x = cfg.margin.left + s.left + s.width / 2 - size.w / 2;
    const y = yOf.get(n.id)! + shiftY;
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
      regPlace: regOf(n),
      isTarget: n.isTarget,
      isMerged: n.isMerged,
      control: n.control ?? false,
      row: 0,
    });
  }

  const splitApplied = applyZoneSplit(layoutNodes, cfg);
  const nodeById = new Map(layoutNodes.map((n) => [n.id, n]));
  const nodeRects = layoutNodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));

  // 连线：单父节点独立直连（控股链保持纵向）；多股东汇聚时各股东下探到一条共享横线，
  // 再由单一入口箭头进入被投资企业（避免每条股东线各画一条横向折线互相重叠）
  const segments: LayoutSegment[] = [];
  let laneCounter = 0;
  const nextLane = () => Math.min(8 + laneCounter++ * 8, 34);
  const byTo = new Map<string, Array<{ fromId: string; ratio: number | null }>>();
  for (const e of tree.edges) {
    const list = byTo.get(e.toId);
    if (list) list.push({ fromId: e.fromId, ratio: e.ratio });
    else byTo.set(e.toId, [{ fromId: e.fromId, ratio: e.ratio }]);
  }
  for (const [toId, incoming] of byTo) {
    const to = nodeById.get(toId)!;
    const ordered = incoming
      .slice()
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
      .map((e) => nodeById.get(e.fromId))
      .filter((n): n is LayoutNode => Boolean(n));
    const cx = to.x + to.w / 2;
    const cy = to.y;

    if (ordered.length === 1) {
      const f = ordered[0];
      const sx = f.x + f.w / 2;
      const sy = f.y + f.h;
      // 同层/逆向补充边或换行后位于第 1 行及以下的股东：从投资方引出，经左侧车道进入被投资企业
      if (f.y + f.h > to.y + 1 || (rowOfParent.get(toId)?.get(f.id) ?? 0) > 0) {
        pushLanePath(segments, f, to, nextLane(), sx);
        continue;
      }
      // 落点在被投资企业上边沿内且不穿框时直连，否则做单条局部短折
      if (sx > to.x + 1 && sx < to.x + to.w - 1 && !crossesAny(sx, sy, sx, cy, nodeRects)) {
        segments.push({
          x1: sx,
          y1: sy,
          x2: sx,
          y2: cy,
          arrow: true,
          edgeId: f.id,
          toId: to.id,
          kind: 'entry',
          control: f.control,
        });
        continue;
      }
      const jogY = cy - 18;
      segments.push({ x1: sx, y1: sy, x2: sx, y2: jogY, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
      segments.push({ x1: sx, y1: jogY, x2: cx, y2: jogY, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
      segments.push({ x1: cx, y1: jogY, x2: cx, y2: cy, arrow: true, edgeId: f.id, toId: to.id, kind: 'entry', control: f.control });
      continue;
    }

    // 多股东汇聚：各股东竖直下探到同一条共享横线，再经单一入口箭头进入被投资企业；
    // 换行后位于第 1 行及以下（或直连穿框）的股东经共享车道接入横线，避免穿过上一行文本框
    const drops: Array<{ f: LayoutNode; sx: number; sy: number }> = [];
    const laneFroms: LayoutNode[] = [];
    for (const f of ordered) {
      const sx = f.x + f.w / 2;
      const sy = f.y + f.h;
      if (
        f.y + f.h > to.y + 1 ||
        (rowOfParent.get(toId)?.get(f.id) ?? 0) > 0 ||
        crossesAny(sx, sy, sx, to.y, nodeRects)
      ) {
        laneFroms.push(f);
        continue;
      }
      drops.push({ f, sx, sy });
    }
    if (drops.length === 0 && laneFroms.length === 0) continue;
    const jogY = cy - 18;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const d of drops) {
      segments.push({
        x1: d.sx,
        y1: d.sy,
        x2: d.sx,
        y2: jogY,
        arrow: false,
        edgeId: d.f.id,
        toId: to.id,
        kind: 'drop',
        control: d.f.control,
      });
      minX = Math.min(minX, d.sx);
      maxX = Math.max(maxX, d.sx);
    }
    if (laneFroms.length > 0) {
      // 共享车道：所有需绕行的股东先引出到同一条车道，车道竖直段直通共享横线
      const laneX = nextLane();
      let laneTop = Infinity;
      for (const f of laneFroms) {
        const sx = f.x + f.w / 2;
        const fromAbove = f.y + f.h <= to.y + 1;
        const exitY = fromAbove ? f.y + f.h : f.y;
        const exitDir = fromAbove ? 4 : -4;
        laneTop = Math.min(laneTop, exitY + exitDir);
        segments.push({ x1: sx, y1: exitY, x2: sx, y2: exitY + exitDir, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
        segments.push({ x1: sx, y1: exitY + exitDir, x2: laneX, y2: exitY + exitDir, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
      }
      const primaryLane = ordered[0];
      segments.push({
        x1: laneX,
        y1: laneTop,
        x2: laneX,
        y2: jogY,
        arrow: false,
        edgeId: primaryLane.id,
        toId: to.id,
        kind: 'drop',
        control: to.control ?? false,
      });
      minX = Math.min(minX, laneX);
      maxX = Math.max(maxX, laneX);
    }
    const primary = ordered[0]; // 持股比例最大的股东（已按降序）
    segments.push({
      x1: minX,
      y1: jogY,
      x2: maxX,
      y2: jogY,
      arrow: false,
      edgeId: primary.id,
      toId: to.id,
      kind: 'bus',
      control: to.control ?? false,
    });
    segments.push({
      x1: cx,
      y1: jogY,
      x2: cx,
      y2: cy,
      arrow: true,
      edgeId: primary.id,
      toId: to.id,
      kind: 'entry',
      control: to.control ?? false,
    });
  }

  const width = cfg.margin.left + totalW + cfg.margin.right;
  const height = Math.max(...layoutNodes.map((n) => n.y + n.h), cfg.margin.top) + cfg.margin.bottom;
  const edges: EquityEdge[] = tree.edges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
    ratio: e.ratio,
    label: e.label,
    control: nodeOf.get(e.fromId)?.control ?? false,
  }));
  // 连接路径归属到 Edge（渲染器只遍历 Edge）
  const primaryOf = new Map<string, string>();
  for (const [toId, incoming] of byTo) {
    const best = incoming.slice().sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))[0];
    if (best) primaryOf.set(toId, best.fromId);
  }
  for (const e of edges) {
    e.path = segments.filter(
      (s) =>
        s.toId === e.toId &&
        (s.edgeId === e.fromId || (s.edgeId === e.toId && primaryOf.get(e.toId) === e.fromId)),
    );
  }

  const layout: LayoutResult = {
    nodes: layoutNodes,
    segments,
    edges,
    labels: [],
    boundary: null,
    width,
    height,
  };

  // 安全网：节点重叠或连线穿框时放大间距重排
  const report = checkLayout(layout);
  if (report.nodeOverlaps > 0 || report.segmentNodeHits > 0) {
    if (splitApplied) {
      return layoutBankOwnership(tree, { ...cfg, zoneSplit: false }, depth + 1);
    }
    if (depth < 3) {
      return layoutBankOwnership(
        tree,
        {
          ...cfg,
          hGap: cfg.hGap + 24,
          rowGap: cfg.rowGap + 32,
        },
        depth + 1,
      );
    }
    return layout;
  }
  return layout;
}

/**
 * 通用车道路径：投资方在上时从底边引出、进入被投资企业顶边；
 * 同层/逆向补充边时从顶边引出（先进入上方空隙），统一进入被投资企业顶边。
 */
function pushLanePath(
  segments: LayoutSegment[],
  f: LayoutNode,
  to: LayoutNode,
  laneX: number,
  exitX: number,
): void {
  const fromAbove = f.y + f.h <= to.y + 1;
  const exitY = fromAbove ? f.y + f.h : f.y;
  const exitDir = fromAbove ? 4 : -4;
  const enterX = to.x + to.w / 2;
  const laneEndY = to.y - 14;
  segments.push({ x1: exitX, y1: exitY, x2: exitX, y2: exitY + exitDir, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
  segments.push({ x1: exitX, y1: exitY + exitDir, x2: laneX, y2: exitY + exitDir, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
  segments.push({ x1: laneX, y1: exitY + exitDir, x2: laneX, y2: laneEndY, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
  segments.push({ x1: laneX, y1: laneEndY, x2: enterX, y2: laneEndY, arrow: false, edgeId: f.id, toId: to.id, kind: 'drop', control: f.control });
  segments.push({ x1: enterX, y1: laneEndY, x2: enterX, y2: to.y, arrow: true, edgeId: f.id, toId: to.id, kind: 'entry', control: f.control });
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
 * 境内/境外分区：当境外股东无法自然位于境内节点上方时，
 * 将境外节点统一提升到顶部（超过 5 个同样换行），境内节点整体下移至虚线下方，
 * 保留各层横向“带”排列。
 */
function applyZoneSplit(nodes: LayoutNode[], cfg: LayoutConfig): boolean {
  const overseas = nodes.filter((n) => n.stopReason === 'overseas');
  const domestic = nodes.filter((n) => n.stopReason !== 'overseas');
  if (overseas.length === 0 || domestic.length === 0 || cfg.zoneSplit === false) return false;

  const overseasBottom = Math.max(...overseas.map((n) => n.y + n.h));
  const domesticTop = Math.min(...domestic.map((n) => n.y));
  // 已能自然画出分隔线（境外全部在上且空间足够）时无需调整
  if (overseasBottom + BOUNDARY_MIN_PAD + BOUNDARY_LABEL_H + 8 <= domesticTop) return false;

  // 境外股东统一提升到顶部，超过 MAX_PER_ROW 个时换行排列
  const ovTop = Math.min(...overseas.map((n) => n.y));
  const ovRowH = Math.max(...overseas.map((n) => n.h));
  const ovRows: LayoutNode[][] = [];
  for (let i = 0; i < overseas.length; i += MAX_PER_ROW) ovRows.push(overseas.slice(i, i + MAX_PER_ROW));
  ovRows.forEach((r, ri) => {
    for (const n of r) n.y = ovTop + ri * (ovRowH + ROW_GAP);
  });
  const ovBottom = ovTop + (ovRows.length - 1) * (ovRowH + ROW_GAP) + ovRowH;
  const boundaryY = Math.max(ovBottom + BOUNDARY_PAD, ovBottom + BOUNDARY_MIN_PAD);

  // 境内节点整体下移到虚线下方，保留原有横向带与行排列
  const minDomesticY = Math.min(...domestic.map((n) => n.y));
  const dy = boundaryY + BOUNDARY_LABEL_H + 10 - minDomesticY;
  for (const n of domestic) n.y += dy;
  return true;
}

export type RatioLabelSideMode = 'both' | 'right';

const LABEL_GAP = 6; // 比例标签与连接线的水平间距
const COMPACT_LABEL_FONT = 8; // 页面紧凑时比例标签缩小后的字号
const VERTICAL_NAME_W = 34; // 纵向排版时文本框宽度（约一个字宽）
const MAX_PER_ROW = 5; // 同一父节点下每行最多节点数：超过自动换行
const ROW_GAP = 24; // 同层内行与行之间的竖直间距（放引出线）
const MANY_SHAREHOLDERS = 7; // 同层股东数量达到该值视为“较多”，触发混合排版
const SMALL_RATIO = 5; // 混合排版中持股低于该百分比（%）的股东使用纵向文本框
const BOUNDARY_PAD = 26; // 分隔线与境外节点底部的间距（含“境外”标签）
const BOUNDARY_MIN_PAD = 16; // 境外节点底部到虚线的最小间距
const BOUNDARY_LABEL_H = 14; // “境外/境内”标签高度

/**
 * 连线冲突着色：存在交叉或共线重叠的连线改为调色板颜色（默认黑色之外），
 * 同一持股路径的所有线段使用同一颜色，避免视觉混淆且保持可打印。
 */
export function applySegmentColors(segments: LayoutSegment[]): void {
  const crossing = findSegmentCrossings(segments);
  const overlap = findSegmentCollinearOverlaps(segments);
  const involved = new Set<number>();
  for (const p of [...crossing, ...overlap]) {
    involved.add(p.i);
    involved.add(p.j);
  }
  if (involved.size === 0) return;
  const edgeColors = new Map<string, string>();
  let colorIdx = 0;
  for (const idx of [...involved].sort((a, b) => a - b)) {
    const seg = segments[idx];
    const key = seg.edgeId;
    let color = edgeColors.get(key);
    if (!color) {
      color = EDGE_CROSS_COLORS[colorIdx % EDGE_CROSS_COLORS.length];
      colorIdx++;
      edgeColors.set(key, color);
    }
    seg.color = color;
  }
}

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

  // 持股比例：显示在股权线两侧、线中间位置（左下方/右下方方位），始终不与线相交
  const labels: RatioLabel[] = [];
  const byTo = new Map<string, Array<{ fromId: string; text: string }>>();
  for (const e of layout.edges) {
    const list = byTo.get(e.toId);
    if (list) list.push({ fromId: e.fromId, text: e.label });
    else byTo.set(e.toId, [{ fromId: e.fromId, text: e.label }]);
  }
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
        // 只取从该股东文本框底部引出的线段（区分“股东→被投资企业”与“其自身被上层持股”）
        (s) =>
          (s.kind === 'drop' || s.kind === 'entry') &&
          s.edgeId === e.fromId &&
          Math.abs(s.y1 - (e.from.y + e.from.h)) <= 4,
      );
      if (candidates.length === 0) return;
      const seg = candidates.reduce((best, s) =>
        Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1) >
        Math.abs(best.x2 - best.x1) + Math.abs(best.y2 - best.y1)
          ? s
          : best,
      );

      // 位于股东文本框下方、偏向被投资企业一侧（左下/右下方位），靠近框底更易对应投资关系
      const dropLen = Math.abs(seg.y2 - seg.y1);
      let anchorY = seg.y1 + Math.min(dropLen * 0.3, 12);
      if (boundary && seg.y1 < boundary.y && seg.y2 > boundary.y) {
        anchorY = Math.min(boundary.y + 12, seg.y2 - 10);
      }
      // 朝向被投资企业一侧：股东在被投资企业左侧则标在右下，右侧则标在左下
      const preferred: RatioLabelSide = sideMode === 'right' ? 'right' : e.from.x <= to.x ? 'right' : 'left';
      // 候选位置：优先同侧，必要时加大间距/上下偏移/换到另一侧，避免与连线或文本框重合；
      // 页面紧凑时先缩小标签字号再放宽间距，保证每个层级都明确标注且不遮挡股权线
      const placements: Array<{ side: RatioLabelSide; dy: number; gap: number }> = [];
      const sides: RatioLabelSide[] =
        sideMode === 'right' ? ['right'] : [preferred, preferred === 'left' ? 'right' : 'left'];
      for (const side of sides) {
        for (const dy of [0, -10, 10, -20, 20, -30, 30]) {
          for (const gap of [LABEL_GAP, LABEL_GAP + 8, LABEL_GAP + 16, LABEL_GAP + 26]) {
            placements.push({ side, dy, gap });
          }
        }
      }
      const tryPlace = (size: { w: number; h: number }): { x: number; y: number; side: RatioLabelSide; score: number } | null => {
        let best: { x: number; y: number; side: RatioLabelSide; score: number } | null = null;
        for (const c of placements) {
          const cx = c.side === 'left' ? seg.x1 - c.gap - size.w : seg.x1 + c.gap;
          const cy = anchorY + c.dy - size.h / 2;
          const rect = { x: cx, y: cy, w: size.w, h: size.h };
          const hitNode = layout.nodes.some((n) => rectsOverlap(rect, { x: n.x, y: n.y, w: n.w, h: n.h }));
          const hitSeg = layout.segments.some((s) => segIntersectsRectStrict(s.x1, s.y1, s.x2, s.y2, rect));
          const hitLabel = labels.some((l) => rectsOverlap(rect, { x: l.x, y: l.y, w: l.w, h: l.h }));
          const score = (hitNode ? 1 : 0) + (hitSeg ? 1 : 0) + (hitLabel ? 1 : 0);
          if (score === 0) return { x: cx, y: cy, side: c.side, score };
          if (best === null || score < best.score) best = { x: cx, y: cy, side: c.side, score };
        }
        return best;
      };
      const normalSize = ratioLabelSize(text);
      let size = normalSize;
      let chosen = tryPlace(normalSize);
      if (chosen && chosen.score > 0) {
        // 紧凑回退：缩小标签字号后重试，仍无法完全避让时选重叠最少的候选
        const compactSize = ratioLabelSize(text, COMPACT_LABEL_FONT);
        const compact = tryPlace(compactSize);
        if (compact && compact.score < chosen.score) {
          chosen = compact;
          size = compactSize;
        }
      }
      if (!chosen) {
        chosen = {
          x: preferred === 'left' ? seg.x1 - LABEL_GAP - size.w : seg.x1 + LABEL_GAP,
          y: anchorY - size.h / 2,
          side: preferred,
          score: 1,
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
      // 持股比例提升为 Edge 属性：位置写入 EquityEdge.labelPosition，供 PPT 生成阶段使用
      const edge = layout.edges.find((ed) => ed.fromId === e.fromId && ed.toId === toId);
      if (edge) {
        edge.labelPosition = {
          side: chosen.side,
          x: chosen.x,
          y: chosen.y,
          w: size.w,
          h: size.h,
          anchorX: seg.x1,
          anchorY,
        };
      }
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
  // 连线交叉/重叠着色（放最后，避免影响标签避让计算）
  applySegmentColors(layout.segments);
  return layout;
}
