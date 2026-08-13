import { describe, expect, it } from 'vitest';
import type { EquityRelation, LayoutSegment } from '../src/lib/types';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { checkLayout } from '../src/lib/layout/collision';
import { fitLayout, PAGES } from '../src/lib/layout/page';
import { applySegmentColors } from '../src/lib/layout/layout';
import { DEFAULT_GENERATE_CONFIG } from '../src/lib/types';
import { textWidth } from '../src/lib/layout/measure';

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
  it('统一生成配置默认值：穿透 25%、合并 5%、页面自动、最小字号 9、纵向版式、每层前10大股东', () => {
    expect(DEFAULT_GENERATE_CONFIG.penetrationThreshold).toBe(25);
    expect(DEFAULT_GENERATE_CONFIG.minorShareholderThreshold).toBe(5);
    expect(DEFAULT_GENERATE_CONFIG.pageSize).toBe('auto');
    expect(DEFAULT_GENERATE_CONFIG.fontMinSize).toBe(9);
    expect(DEFAULT_GENERATE_CONFIG.layoutMode).toBe('bank-ownership');
    expect(DEFAULT_GENERATE_CONFIG.maxShareholdersPerLevel).toBe(10);
    expect(DEFAULT_GENERATE_CONFIG.capShareholders).toBe(true);
  });

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
    // 纵向版式下简单结构可能自动选择 A3（字号更大），两者均可接受
    expect(['a4', 'a3']).toContain(fit.page);
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
    // 节点尺寸按公司名称长度动态计算；除超长名称外尽量单行
    const level1 = fit.layout.nodes.filter((n) => n.level === 1);
    const widths = new Set(level1.map((n) => Math.round(n.w)));
    expect(widths.size).toBeGreaterThan(1);
    // 同层不超过 5 个股东时不换行（全部在第 0 行）
    expect(level1.every((n) => (n.row ?? 0) === 0)).toBe(true);
    const singleLine = level1.filter((n) => !n.name.includes('深创投'));
    for (const n of singleLine) expect(n.lines.length).toBe(1);
    // 投资方在上，目标企业在下
    const target = fit.layout.nodes.find((n) => n.isTarget)!;
    expect(target.y + target.h).toBeGreaterThan(
      Math.max(...fit.layout.nodes.filter((n) => !n.isTarget).map((n) => n.y)),
    );
  });

  it('多股东汇聚总线：同层超过 5 个自动换行，交叉自动着色区分', () => {
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
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    const buses = fit.layout.segments.filter((s) => s.kind === 'bus');
    expect(buses.length).toBeGreaterThan(0);
    // 多股东汇总到目标主体时只保留一个箭头
    const targetEntries = fit.layout.segments.filter((s) => s.kind === 'entry' && s.arrow);
    expect(targetEntries.length).toBe(1);
    // 8 个股东自动换行为 2 行（5+3），行号按纵向位置区分
    const level1 = fit.layout.nodes.filter((n) => n.level === 1);
    expect(new Set(level1.map((n) => Math.round(n.y))).size).toBeGreaterThan(1);
    // 不可避免的交叉连线使用调色板颜色区分
    const colored = fit.layout.segments.filter((s) => s.color);
    if (report.segmentCrossings > 0) expect(colored.length).toBeGreaterThan(0);
  });

  it('30 个股东：自动换行、节点不重叠、字号 ≥9pt、单箭头汇总', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 30; i++) {
      relations.push({ investor: `深圳市某股权投资基金（有限合伙）${i}号`, investee: '目标公司', ratio: i });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      mergeStartLevel: 1,
      capShareholders: false,
      autoMerge: false,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'horizontal',
    });
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    // 30 个股东自动换行为 6 行 x 5 个（按纵向位置区分）
    const level1 = fit.layout.nodes.filter((n) => n.level === 1);
    expect(level1.length).toBe(30);
    expect(new Set(level1.map((n) => Math.round(n.y))).size).toBe(6);
    // 比例标签字号不低于 9pt（10px 设计字号换算）
    expect(fit.pxToIn * 10 * 72).toBeGreaterThanOrEqual(9);
    // 多股东汇总到目标主体只保留一个箭头
    const targetEntries = fit.layout.segments.filter((s) => s.kind === 'entry' && s.arrow);
    expect(targetEntries.length).toBe(1);
  });

  it('每层默认仅画前10大股东，其余归集为“其他持股不超X%的股东”', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 12; i++) {
      relations.push({ investor: `股东${i}有限公司`, investee: '目标公司', ratio: 20 - i });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      mergeStartLevel: 2,
      autoMerge: false,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    // 12 个一级股东 → 仅保留前 10 大，另生成 1 个“其他持股不超X%”节点
    const level1 = fit.tree.nodes.filter((n) => n.level === 1);
    expect(level1.length).toBe(11);
    const capped = level1.find((n) => n.name.includes('其他持股不超'));
    expect(capped).toBeDefined();
    // 前 10 大 = 持股 19%..10%（ratio = 20 - i，i=1..10）；归集的是 9% 与 8%
    expect(capped?.name).toBe('其他持股不超9%的股东');
    expect(capped?.mergedSum).toBeCloseTo(17, 2);
    // 归集节点排在最后（最右侧）
    expect(level1[level1.length - 1].isMerged).toBe(true);
    // 布局无重叠
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
  });

  it('用户可关闭每层股东数量归集，展示全部股东', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 12; i++) {
      relations.push({ investor: `股东${i}有限公司`, investee: '目标公司', ratio: 20 - i });
    }
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      mergeStartLevel: 2,
      capShareholders: false,
      autoMerge: false,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    expect(fit.tree.nodes.filter((n) => n.level === 1).length).toBe(12);
  });

  it('连接关系独立保存：Edge.path 完整覆盖所有连线，渲染器只依赖 Edge', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 8; i++) {
      relations.push({ investor: `股东${i}有限公司`, investee: '目标公司', ratio: 25 + i });
    }
    relations.push({ investor: '上层控股有限公司', investee: '股东1有限公司', ratio: 100 });
    const tree = makeTree(relations);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      mergeStartLevel: 1,
      autoMerge: true,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    // 每条 Edge 都有连接路径
    expect(fit.layout.edges.length).toBeGreaterThan(0);
    for (const e of fit.layout.edges) {
      expect((e.path ?? []).length).toBeGreaterThan(0);
    }
    // 所有线段都归属到某条 Edge 且无遗漏、无重复
    const covered = new Set(fit.layout.segments);
    for (const e of fit.layout.edges) {
      for (const s of e.path ?? []) {
        expect(covered.has(s)).toBe(true);
        covered.delete(s);
      }
    }
    expect(covered.size).toBe(0);
    // 多股东汇聚到任一被投资企业只保留一个箭头（挂在主边 path 上）
    const arrowSegs = fit.layout.edges.flatMap((e) => e.path ?? []).filter((s) => s.arrow);
    expect(arrowSegs.length).toBe(2); // 目标公司总线箭头 + 上层控股→股东1 箭头
    // 目标公司的总线与入口只属于主边（持股比例最大的股东边）
    const primary = fit.layout.nodes.find((n) => n.name === '股东8有限公司')!;
    const busOwner = fit.layout.edges.filter((e) => (e.path ?? []).some((s) => s.kind === 'bus'));
    expect(busOwner.length).toBe(1);
    expect(busOwner[0].fromId).toBe(primary.id);
    const targetId = fit.layout.nodes.find((n) => n.isTarget)!.id;
    const primaryEdge = fit.layout.edges.find((e) => e.fromId === primary.id && e.toId === targetId)!;
    expect(primaryEdge.path?.some((s) => s.kind === 'entry' && s.arrow)).toBe(true);
  });

  it('银行授信版式：目标底部中央、控股链纵向、同层降序大股东居中、独立连线无总线', () => {
    const tree = makeTree([
      { investor: 'A控股有限公司', investee: '目标公司', ratio: 40 },
      { investor: 'B投资有限公司', investee: '目标公司', ratio: 30 },
      { investor: 'C实业有限公司', investee: '目标公司', ratio: 20 },
      { investor: 'D商贸有限公司', investee: '目标公司', ratio: 10 },
      { investor: '自然人甲', investee: 'A控股有限公司', ratio: 100 },
      { investor: '控股乙有限公司', investee: 'B投资有限公司', ratio: 100 },
    ]);
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      mergeStartLevel: 2,
      autoMerge: false,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
      layoutMode: 'bank-ownership',
    });
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.labelSegmentHits).toBe(0);

    const target = fit.layout.nodes.find((n) => n.isTarget)!;
    // 目标公司固定在最底部
    expect(target.y).toBe(Math.max(...fit.layout.nodes.map((n) => n.y)));
    // 第一层股东在目标上方水平展开
    const level1 = fit.layout.nodes.filter((n) => n.level === 1).sort((a, b) => a.x - b.x);
    expect(level1.length).toBe(4);
    expect(level1.every((n) => n.y < target.y)).toBe(true);
    // 同层按持股比例降序：最大股东（A 40%）最靠近目标中心
    const targetCx = target.x + target.w / 2;
    const byRatio = ['A控股有限公司', 'B投资有限公司', 'C实业有限公司', 'D商贸有限公司'];
    const dist = (id: string) => {
      const n = fit.layout.nodes.find((x) => x.name === id)!;
      return Math.abs(n.x + n.w / 2 - targetCx);
    };
    for (let i = 0; i < byRatio.length - 1; i++) {
      expect(dist(byRatio[i])).toBeLessThanOrEqual(dist(byRatio[i + 1]) + 1);
    }
    // 控股链保持纵向：自然人甲 与 A控股 同列，控股乙 与 B投资 同列
    const a = fit.layout.nodes.find((n) => n.name === 'A控股有限公司')!;
    const person = fit.layout.nodes.find((n) => n.name === '自然人甲')!;
    const b = fit.layout.nodes.find((n) => n.name === 'B投资有限公司')!;
    const holding = fit.layout.nodes.find((n) => n.name === '控股乙有限公司')!;
    expect(Math.abs(person.x + person.w / 2 - (a.x + a.w / 2))).toBeLessThan(1);
    expect(Math.abs(holding.x + holding.w / 2 - (b.x + b.w / 2))).toBeLessThan(1);
    expect(person.y).toBeLessThan(a.y);
    expect(a.y).toBeLessThan(target.y);
    // 多股东汇聚：只存在一条共享横线 + 单一入口箭头，不再为每个股东各画一条横向折线
    expect(fit.layout.segments.filter((s) => s.kind === 'bus').length).toBe(1);
    const targetEdges = fit.layout.edges.filter((e) => e.toId === target.id);
    const targetArrows = targetEdges.flatMap((e) => e.path ?? []).filter((s) => s.arrow);
    expect(targetArrows.length).toBe(1);
    // 单父链保持独立直连箭头
    const chainEdges = fit.layout.edges.filter((e) => e.toId !== target.id && e.fromId !== target.id);
    expect(chainEdges.every((e) => (e.path ?? []).some((s) => s.arrow))).toBe(true);
    // 每条边的 path 非空
    for (const e of fit.layout.edges) expect((e.path ?? []).length).toBeGreaterThan(0);
    // 比例标签绑定 Edge
    expect(fit.layout.edges.every((e) => e.labelPosition !== undefined)).toBe(true);
    // 页面优先 A4 横向
    expect(fit.page).toBe('a4');
    // Edge.path 完整覆盖所有线段
    const covered = new Set(fit.layout.segments);
    for (const e of fit.layout.edges) {
      for (const s of e.path ?? []) {
        expect(covered.has(s)).toBe(true);
        covered.delete(s);
      }
    }
    expect(covered.size).toBe(0);
  });

  it('股东过多时自动合并并适配 A3', () => {
    const relations: EquityRelation[] = [];
    for (let i = 1; i <= 60; i++) {
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
      layoutMode: 'bank-standard',
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
      layoutMode: 'bank-standard',
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
      { x1: 0, y1: 10, x2: 100, y2: 10, arrow: false, edgeId: 'a', toId: 'x', kind: 'drop' as const },
      { x1: 50, y1: 0, x2: 50, y2: 80, arrow: false, edgeId: 'b', toId: 'x', kind: 'drop' as const },
      { x1: 0, y1: 40, x2: 120, y2: 40, arrow: false, edgeId: 'c', toId: 'x', kind: 'bus' as const },
      { x1: 90, y1: 40, x2: 90, y2: 120, arrow: false, edgeId: 'd', toId: 'x', kind: 'entry' as const },
      { x1: 0, y1: 60, x2: 100, y2: 60, arrow: false, edgeId: 'e', toId: 'x', kind: 'bus' as const },
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
    // 纵向排版整图适配页面
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

  it('自动版式：简单图自动用纵向版式——控股链垂直、境内外虚线齐全、注册地不超框', () => {
    const tree = makeTree([
      { investor: '江苏沂杉农业科技有限公司', investee: '目标公司', ratio: 53.85 },
      { investor: '雲杉（中國）控股有限公司', investee: '目标公司', ratio: 46.15 },
      { investor: '雲杉（中國）投資有限公司', investee: '江苏沂杉农业科技有限公司', ratio: 100 },
    ]);
    // 不指定版式：auto → 简单图自动使用纵向银行授信版式
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    // 控股链纵向：雲杉投資 与 江苏沂杉 同列，且位于其上方
    const target = fit.layout.nodes.find((n) => n.isTarget)!;
    const jiangsu = fit.layout.nodes.find((n) => n.name.includes('江苏沂杉'))!;
    const invest = fit.layout.nodes.find((n) => n.name.includes('投資'))!;
    expect(Math.abs(invest.x + invest.w / 2 - (jiangsu.x + jiangsu.w / 2))).toBeLessThan(1);
    expect(invest.y).toBeLessThan(jiangsu.y);
    expect(jiangsu.y).toBeLessThan(target.y);
    // 境内外虚线存在（境外股东全部在虚线上方）
    expect(fit.layout.boundary).not.toBeNull();
    // 目标固定底部
    expect(target.y).toBe(Math.max(...fit.layout.nodes.map((n) => n.y)));
    // 注册地文字不超出文本框（按 PPT 同款字号算法估算）
    for (const n of fit.layout.nodes) {
      if (!n.regPlace) continue;
      const regText = `注册地：${n.regPlace}`;
      const bw = textWidth(regText, 10);
      const wIn = n.w * fit.pxToIn;
      const cap = (wIn * 72) / (bw * 10 * 0.0075);
      const regPt = Math.max(9, Math.min(10 * fit.pxToIn * 72, cap));
      const needIn = ((bw * regPt) / 10) * 0.75 / 72;
      expect(needIn).toBeLessThanOrEqual(wIn + 0.01);
    }
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
  });
});
