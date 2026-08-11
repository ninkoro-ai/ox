import { describe, expect, it } from 'vitest';
import type { EquityRelation, LayoutSegment } from '../src/lib/types';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { checkLayout } from '../src/lib/layout/collision';
import { fitLayout, PAGES } from '../src/lib/layout/page';
import { applySegmentColors } from '../src/lib/layout/layout';

const OPTS = {
  threshold: 25,
  stopAtNaturalPerson: true,
  stopAtOverseas: true,
  showBelowThreshold: true,
  maxLevel: 20,
};

function makeTree(relations: EquityRelation[]) {
  return buildEquityTree('目标公司', relations, {}, OPTS);
}

describe('布局引擎', () => {
  it('小树无重叠，优先 A4 紧凑版面', () => {
    const tree = makeTree([
      { investor: '旭阳集团有限公司', investee: '目标公司', ratio: 80.48 },
      { investor: '深创投制造业转型升级新材料基金（有限合伙）', investee: '目标公司', ratio: 14.19 },
      { investor: '農银金融资产投资有限公司', investee: '目标公司', ratio: 5.32 },
      { investor: '邢台旭阳煤化工有限公司', investee: '目标公司', ratio: 0.01 },
      { investor: '中國旭陽集團（香港）有限公司', investee: '旭阳集团有限公司', ratio: 100 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    expect(fit.page).toBe('a4');
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.segmentCrossings).toBe(0);
    expect(report.labelNodeHits).toBe(0);
    expect(report.labelOverlaps).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    // 比例标签在线两侧（朝向被投资企业一侧），页面紧凑时自动缩字号避让
    expect(fit.layout.labels.length).toBeGreaterThan(0);
    expect(fit.layout.labels.some((l) => l.side === 'left')).toBe(true);
    expect(fit.layout.labels.some((l) => l.side === 'right')).toBe(true);
    // 每个有比例的持股关系都必须标注
    const edgeTexts = fit.layout.edges.filter((e) => e.label && e.label !== '—' && e.label !== '不详');
    const labelTexts = new Set(fit.layout.labels.map((l) => l.edgeId));
    for (const e of edgeTexts) expect(labelTexts.has(e.fromId)).toBe(true);
    // 标签不与股权线相交
    expect(report.labelSegmentHits).toBe(0);
    // 无交叉时连线保持黑色
    expect(fit.layout.segments.every((s) => s.color === undefined)).toBe(true);
    // 有境外股东时绘制境内外分隔虚线
    expect(fit.layout.boundary).not.toBeNull();
    // 同一层股东文本框等宽；除超长名称外尽量单行
    const level1 = fit.layout.nodes.filter((n) => n.level === 1);
    const widths = new Set(level1.map((n) => Math.round(n.w)));
    expect(widths.size).toBe(1);
    const singleLine = level1.filter((n) => !n.name.includes('深创投'));
    for (const n of singleLine) expect(n.lines.length).toBe(1);
    expect(fit.layout.nodes.filter((n) => n.level === 1 && n.lines.length === 1).length).toBeGreaterThanOrEqual(3);
    // 投资方在上，目标企业在下
    const target = fit.layout.nodes.find((n) => n.isTarget)!;
    expect(target.y + target.h).toBeGreaterThan(
      Math.max(...fit.layout.nodes.filter((n) => !n.isTarget).map((n) => n.y)),
    );
  });

  it('多股东汇聚总线（不产生交叉）', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 8; i++) {
      relations.push({ investor: `股东${i}有限公司`, investee: '目标公司', ratio: 10 + i });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    const report = checkLayout(fit.layout);
    expect(report.segmentCrossings).toBe(0);
    const buses = fit.layout.segments.filter((s) => s.kind === 'bus');
    expect(buses.length).toBeGreaterThan(0);
    // 多股东汇总到目标主体时只保留一个箭头
    const targetEntries = fit.layout.segments.filter((s) => s.kind === 'entry' && s.arrow);
    expect(targetEntries.length).toBe(1);
  });

  it('股东过多时自动合并并适配 A3', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 40; i++) {
      relations.push({ investor: `低比例股东${i}有限公司`, investee: '目标公司', ratio: 0.1 + i * 0.01 });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      mergeStartLevel: 1,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    expect(fit.mergedGroups).toBeGreaterThan(0);
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
  });

  it('生成前归并低于阈值的股东为“其他单一持股不超过X%的股东”', () => {
    const tree = makeTree([
      { investor: '大股东A', investee: '目标公司', ratio: 60 },
      { investor: '小股东B', investee: '目标公司', ratio: 8 },
      { investor: '小股东C', investee: '目标公司', ratio: 5 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 10,
      mergeStartLevel: 1,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
    });
    const merged = fit.tree.nodes.find((n) => n.name.includes('其他单一持股不超过10%'));
    expect(merged).toBeDefined();
    expect(merged?.mergedSum).toBeCloseTo(13, 2);
    expect(fit.tree.nodes.filter((n) => n.level === 1).length).toBe(2);
  });

  it('合并股东统一在最右侧，其余按持股比例从左到右降序', () => {
    const tree = makeTree([
      { investor: '股东B', investee: '目标公司', ratio: 30 },
      { investor: '小股东C', investee: '目标公司', ratio: 8 },
      { investor: '股东A', investee: '目标公司', ratio: 55 },
      { investor: '小股东D', investee: '目标公司', ratio: 5 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 10,
      mergeStartLevel: 1,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
    });
    const level1 = fit.layout.nodes.filter((n) => n.level === 1).sort((a, b) => a.x - b.x);
    expect(level1.map((n) => n.name)).toEqual(['股东A', '股东B', '其他单一持股不超过10%的股东']);
    expect(level1[level1.length - 1].isMerged).toBe(true);
  });

  it('合并阈值默认从第二层生效：第一层不合并，第二层起合并', () => {
    const tree = makeTree([
      { investor: 'A公司', investee: '目标公司', ratio: 60 },
      { investor: 'B公司', investee: '目标公司', ratio: 8 },
      { investor: 'C公司', investee: '目标公司', ratio: 5 },
      { investor: 'D公司', investee: 'A公司', ratio: 3 },
      { investor: 'E公司', investee: 'A公司', ratio: 2 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 10,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
    });
    // 第一层 B/C（8%、5%）低于阈值但不参与合并，仍单独列示
    const level1 = fit.tree.nodes.filter((n) => n.level === 1);
    expect(level1.map((n) => n.name)).toEqual(expect.arrayContaining(['B公司', 'C公司']));
    expect(level1.length).toBe(3);
    // 第二层 D/E（3%、2%）合并为一个“其他单一持股不超过10%的股东”
    const merged = fit.tree.nodes.find((n) => n.name.includes('其他单一持股不超过10%'));
    expect(merged).toBeDefined();
    expect(merged?.level).toBe(2);
    expect(merged?.mergedSum).toBeCloseTo(5, 2);
  });

  it('用户可设置合并起始层级为第一层', () => {
    const tree = makeTree([
      { investor: 'A公司', investee: '目标公司', ratio: 60 },
      { investor: 'B公司', investee: '目标公司', ratio: 8 },
      { investor: 'C公司', investee: '目标公司', ratio: 5 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 10,
      mergeStartLevel: 1,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
    });
    const merged = fit.tree.nodes.find((n) => n.name.includes('其他单一持股不超过10%'));
    expect(merged).toBeDefined();
    expect(merged?.level).toBe(1);
    expect(fit.tree.nodes.filter((n) => n.level === 1).length).toBe(2);
  });

  it('境外股东与境内股东同层时仍生成虚线且境外在上', () => {
    const tree = makeTree([
      { investor: '香港控股有限公司', investee: '目标公司', ratio: 60 },
      { investor: '境内股东A', investee: '目标公司', ratio: 30 },
      { investor: '境内股东B', investee: '目标公司', ratio: 10 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 10,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    expect(fit.layout.boundary).not.toBeNull();
    const overseas = fit.layout.nodes.filter((n) => n.stopReason === 'overseas');
    const domestic = fit.layout.nodes.filter((n) => n.stopReason !== 'overseas');
    expect(Math.max(...overseas.map((n) => n.y + n.h))).toBeLessThanOrEqual(fit.layout.boundary!.y);
    expect(Math.min(...domestic.map((n) => n.y))).toBeGreaterThan(fit.layout.boundary!.y);
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.segmentCrossings).toBe(0);
    expect(report.labelNodeHits).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
  });

  it('连线交叉/重叠时自动使用不同颜色防止混淆', () => {
    const segments: LayoutSegment[] = [
      { x1: 0, y1: 10, x2: 100, y2: 10, arrow: false, edgeId: 'a', kind: 'drop' as const },
      { x1: 50, y1: 0, x2: 50, y2: 80, arrow: false, edgeId: 'b', kind: 'drop' as const },
      { x1: 0, y1: 40, x2: 120, y2: 40, arrow: false, edgeId: 'c', kind: 'bus' as const },
      { x1: 90, y1: 40, x2: 90, y2: 120, arrow: false, edgeId: 'd', kind: 'entry' as const },
      { x1: 0, y1: 60, x2: 100, y2: 60, arrow: false, edgeId: 'e', kind: 'bus' as const },
    ];
    applySegmentColors(segments);
    const colored = segments.filter((s) => s.color && s.color !== '000000');
    expect(colored.length).toBeGreaterThan(0);
    // 同一持股路径的所有线段同色
    const colorsOfA = segments.filter((s) => s.edgeId === 'a').map((s) => s.color);
    expect(new Set(colorsOfA).size).toBeLessThanOrEqual(1);
    // 参与交叉的路径颜色互不相同
    const distinct = new Set(segments.map((s) => s.color).filter(Boolean));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it('文本框方向由用户选择：横向自动换行不超页，纵向一字一行', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 12; i++) {
      relations.push({ investor: `深圳市某大型股权投资企业（有限合伙）${i}号`, investee: '目标公司', ratio: 5 + i });
    }
    const tree = makeTree(relations);
    const fitH = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'horizontal',
    });
    const pageH = PAGES[fitH.page];
    expect(fitH.layout.width * fitH.pxToIn).toBeLessThanOrEqual(pageH.wIn + 0.01);
    expect(fitH.layout.height * fitH.pxToIn).toBeLessThanOrEqual(pageH.hIn + 0.01);
    const longH = fitH.layout.nodes.find((n) => n.name.includes('大型股权投资'))!;
    expect(longH.lines.length).toBeLessThan([...longH.name].length - 1);

    const fitV = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'vertical',
    });
    const pageV = PAGES[fitV.page];
    expect(fitV.layout.width * fitV.pxToIn).toBeLessThanOrEqual(pageV.wIn + 0.01);
    expect(fitV.layout.height * fitV.pxToIn).toBeLessThanOrEqual(pageV.hIn + 0.01);
    const longV = fitV.layout.nodes.find((n) => n.name.includes('大型股权投资'))!;
    expect(longV.lines.length).toBeGreaterThanOrEqual([...longV.name].length - 1);
  });

  it('股东较多时持股小于5%的股东使用纵向文本框，其余横向', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 9; i++) {
      relations.push({ investor: `股东${i}号某某投资有限公司`, investee: '目标公司', ratio: i });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'combo',
    });
    const ratioByName = new Map(tree.nodes.map((n) => [n.name, n.ratio]));
    const level1 = fit.layout.nodes.filter((n) => n.level === 1);
    const small = level1.filter((n) => (ratioByName.get(n.name) ?? 100) < 5);
    const big = level1.filter((n) => (ratioByName.get(n.name) ?? 100) >= 5);
    expect(small.length).toBe(4);
    expect(big.length).toBe(5);
    for (const n of small) expect(n.lines.length).toBeGreaterThanOrEqual([...n.name].length - 1);
    for (const n of big) expect(n.lines.length).toBeLessThan([...n.name].length - 1);
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
  });

  it('共享主体（多路径叶子）不参与归并，自动合并不产生悬空引用', () => {
    const tree = makeTree([
      { investor: '大股东A', investee: '目标公司', ratio: 51 },
      { investor: '大股东B', investee: '目标公司', ratio: 30 },
      { investor: '共享公司C', investee: '大股东A', ratio: 5 },
      { investor: '共享公司C', investee: '大股东B', ratio: 5 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'horizontal',
    });
    const c = fit.tree.nodes.find((n) => n.name === '共享公司C');
    expect(c).toBeDefined(); // 共享主体未被归并删除
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
  });
});
