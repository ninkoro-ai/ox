import { describe, expect, it } from 'vitest';
import type { EquityRelation } from '../src/lib/types';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { checkLayout } from '../src/lib/layout/collision';
import { fitLayout } from '../src/lib/layout/page';

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
    // A4 紧凑版面：比例统一在连接线右侧
    expect(fit.layout.labels.length).toBeGreaterThan(0);
    expect(fit.layout.labels.every((l) => l.side === 'right')).toBe(true);
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
      autoMerge: false,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
    });
    const level1 = fit.layout.nodes.filter((n) => n.level === 1).sort((a, b) => a.x - b.x);
    expect(level1.map((n) => n.name)).toEqual(['股东A', '股东B', '其他单一持股不超过10%的股东']);
    expect(level1[level1.length - 1].isMerged).toBe(true);
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
});
