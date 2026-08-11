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

export function segmentsCrossStrict(
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

export interface SegmentPair {
  i: number;
  j: number;
}

/**
 * 检测严格交叉（交点不在任何线段端点处）的线段对。
 * 端点相接（T 型汇聚、转角）属于合法连接，不算交叉。
 */
export function findSegmentCrossings(
  segs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): SegmentPair[] {
  const pairs: SegmentPair[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a: [number, number, number, number] = [segs[i].x1, segs[i].y1, segs[i].x2, segs[i].y2];
      const b: [number, number, number, number] = [segs[j].x1, segs[j].y1, segs[j].x2, segs[j].y2];
      if (segmentsCrossStrict(a, b)) pairs.push({ i, j });
    }
  }
  return pairs;
}

/**
 * 检测共线重叠（同一水平线/垂直线上、区间有重叠）的线段对。
 * 仅端点相接（转角/续接）不算重叠。
 */
export function findSegmentCollinearOverlaps(
  segs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): SegmentPair[] {
  const pairs: SegmentPair[] = [];
  const sameAxis = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      const sH = s.y1 === s.y2;
      const tH = t.y1 === t.y2;
      if (sH !== tH) continue;
      if (sH) {
        if (!sameAxis(s.y1, t.y1)) continue;
        const sMin = Math.min(s.x1, s.x2);
        const sMax = Math.max(s.x1, s.x2);
        const tMin = Math.min(t.x1, t.x2);
        const tMax = Math.max(t.x1, t.x2);
        const overlap = Math.min(sMax, tMax) - Math.max(sMin, tMin);
        if (overlap > 1e-6) pairs.push({ i, j });
      } else {
        if (!sameAxis(s.x1, t.x1)) continue;
        const sMin = Math.min(s.y1, s.y2);
        const sMax = Math.max(s.y1, s.y2);
        const tMin = Math.min(t.y1, t.y2);
        const tMax = Math.max(t.y1, t.y2);
        const overlap = Math.min(sMax, tMax) - Math.max(sMin, tMin);
        if (overlap > 1e-6) pairs.push({ i, j });
      }
    }
  }
  return pairs;
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
