import type { LayoutResult } from '../types';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlapStrict(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function pointInRectStrict(px: number, py: number, r: Rect): boolean {
  return px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
}

export function segIntersectsRectStrict(x1: number, y1: number, x2: number, y2: number, r: Rect): boolean {
  // 快速包围盒
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX <= r.x || minX >= r.x + r.w || maxY <= r.y || minY >= r.y + r.h) return false;

  if (x1 === x2) {
    // 垂直段：只检查是否严格穿过矩形内部（端点贴边不算）
    return pointInRectStrict(x1, (minY + maxY) / 2, r);
  }
  if (y1 === y2) {
    return pointInRectStrict((minX + maxX) / 2, y1, r);
  }
  return false;
}

function segmentsCrossStrict(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const aH = ay1 === ay2;
  const bH = by1 === by2;
  if (aH === bH) return false; // 平行段：本布局只有水平/垂直段

  const [h, v] = aH ? [a, b] : [b, a];
  const hy = h[1];
  const vx = v[0] === v[2] ? v[0] : v[1] === v[3] ? v[0] : v[0];
  const vMinY = Math.min(v[1], v[3]);
  const vMaxY = Math.max(v[1], v[3]);
  const hMinX = Math.min(h[0], h[2]);
  const hMaxX = Math.max(h[0], h[2]);

  const onSegX = vx > hMinX && vx < hMaxX;
  const onSegY = hy > vMinY && hy < vMaxY;
  if (!onSegX || !onSegY) return false;

  // 交点是否与某段端点重合（汇聚点属于合法连接，不算交叉）
  const ends = new Set<string>([
    `${h[0]},${h[1]}`,
    `${h[2]},${h[3]}`,
    `${v[0]},${v[1]}`,
    `${v[2]},${v[3]}`,
  ]);
  return !ends.has(`${vx},${hy}`);
}

export interface CollisionReport {
  nodeOverlaps: number;
  segmentNodeHits: number;
  segmentCrossings: number;
  labelNodeHits: number;
  labelOverlaps: number;
  labelSegmentHits: number;
}

export function checkLayout(layout: LayoutResult): CollisionReport {
  const nodeRects: Rect[] = layout.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const labelRects: Rect[] = (layout.labels ?? []).map((l) => ({
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
  }));

  let nodeOverlaps = 0;
  for (let i = 0; i < nodeRects.length; i++) {
    for (let j = i + 1; j < nodeRects.length; j++) {
      if (rectsOverlapStrict(nodeRects[i], nodeRects[j])) nodeOverlaps++;
    }
  }

  let segmentNodeHits = 0;
  for (const s of layout.segments) {
    for (const r of nodeRects) {
      if (segIntersectsRectStrict(s.x1, s.y1, s.x2, s.y2, r)) segmentNodeHits++;
    }
  }

  let segmentCrossings = 0;
  const segs = layout.segments.map(
    (s): [number, number, number, number] => [s.x1, s.y1, s.x2, s.y2],
  );
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segmentsCrossStrict(segs[i], segs[j])) segmentCrossings++;
    }
  }

  let labelNodeHits = 0;
  let labelOverlaps = 0;
  let labelSegmentHits = 0;
  for (const lr of labelRects) {
    for (const r of nodeRects) {
      if (rectsOverlapStrict(lr, r)) labelNodeHits++;
    }
    for (let i = 0; i < labelRects.length; i++) {
      if (labelRects[i] === lr) continue;
      if (rectsOverlapStrict(lr, labelRects[i])) labelOverlaps++;
    }
    for (const s of layout.segments) {
      if (segIntersectsRectStrict(s.x1, s.y1, s.x2, s.y2, lr)) labelSegmentHits++;
    }
  }

  return {
    nodeOverlaps,
    segmentNodeHits,
    segmentCrossings,
    labelNodeHits,
    labelOverlaps,
    labelSegmentHits,
  };
}
