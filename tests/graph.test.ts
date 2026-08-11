import { describe, expect, it } from 'vitest';
import type { EquityRelation } from '../src/lib/types';
import {
  aggregateOwnership,
  allPaths,
  buildEquityGraph,
  detectCycles,
  findBeneficialOwners,
} from '../src/lib/graph/equityGraph';

const REL: EquityRelation[] = [
  { investor: 'A公司', investee: '目标公司', ratio: 40 },
  { investor: 'B公司', investee: '目标公司', ratio: 30 },
  { investor: '张三', investee: 'A公司', ratio: 50 },
  { investor: '张三', investee: 'B公司', ratio: 50 },
  { investor: '王五', investee: 'A公司', ratio: 50 },
];

describe('股权计算引擎（EquityGraph）', () => {
  it('构建 Node + Edge 图：主体去重、多路径边保留、自环忽略', () => {
    const g = buildEquityGraph(REL, { '张三': '自然人' }, '目标公司');
    expect(g.nodes.map((n) => n.name).sort()).toEqual(['A公司', 'B公司', '张三', '王五', '目标公司']);
    expect(g.edges.length).toBe(5);
    expect(g.nodes.find((n) => n.name === '张三')?.entityType).toBe('自然人');
    // 同一投资方→被投资方的多路径边保留
    const g2 = buildEquityGraph([
      { investor: 'X', investee: '目标公司', ratio: 20 },
      { investor: 'X', investee: '目标公司', ratio: 15 },
      { investor: 'X', investee: 'X', ratio: 99 }, // 自环
    ], {}, '目标公司');
    expect(g2.edges.length).toBe(2);
  });

  it('综合持股比例：多路径求和（张三 = 40*50% + 30*50% = 35%）', () => {
    const g = buildEquityGraph(REL, {}, '目标公司');
    const target = g.nodes.find((n) => n.name === '目标公司')!;
    const zs = g.nodes.find((n) => n.name === '张三')!;
    const ww = g.nodes.find((n) => n.name === '王五')!;
    expect(aggregateOwnership(g, zs.id, target.id)).toBeCloseTo(35, 6);
    expect(aggregateOwnership(g, ww.id, target.id)).toBeCloseTo(20, 6);
    expect(aggregateOwnership(g, target.id, target.id)).toBe(100);
  });

  it('交叉持股（环）：综合持股计算不陷入死循环并返回有限值', () => {
    const g = buildEquityGraph([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: 'B公司', investee: 'A公司', ratio: 60 },
      { investor: 'A公司', investee: 'B公司', ratio: 90 },
    ], {}, '目标公司');
    const target = g.nodes.find((n) => n.name === '目标公司')!;
    const a = g.nodes.find((n) => n.name === 'A公司')!;
    const b = g.nodes.find((n) => n.name === 'B公司')!;
    expect(Number.isFinite(aggregateOwnership(g, a.id, target.id) ?? NaN)).toBe(true);
    expect(Number.isFinite(aggregateOwnership(g, b.id, target.id) ?? NaN)).toBe(true);
    expect(detectCycles(g).length).toBeGreaterThan(0);
  });

  it('检测循环（交叉持股）', () => {
    const g = buildEquityGraph([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: 'B公司', investee: 'A公司', ratio: 60 },
      { investor: 'A公司', investee: 'B公司', ratio: 90 },
    ], {}, '目标公司');
    const cycles = detectCycles(g);
    expect(cycles.some((c) => c.includes('A公司') && c.includes('B公司'))).toBe(true);
  });

  it('受益所有人：综合持股超过阈值的节点', () => {
    const g = buildEquityGraph(REL, { '张三': '自然人' }, '目标公司');
    const target = g.nodes.find((n) => n.name === '目标公司')!;
    const owners = findBeneficialOwners(g, target.id, 25);
    // 综合持股 > 阈值的主体均返回（含直接大股东 A/B 与多路径自然人张三）
    expect(owners.map((o) => o.name).sort()).toEqual(['A公司', 'B公司', '张三']);
    expect(owners.find((o) => o.name === '张三')?.aggregate).toBeCloseTo(35, 6);
  });

  it('多路径枚举：张三到目标公司有两条路径', () => {
    const g = buildEquityGraph(REL, {}, '目标公司');
    const target = g.nodes.find((n) => n.name === '目标公司')!;
    const zs = g.nodes.find((n) => n.name === '张三')!;
    const paths = allPaths(g, zs.id, target.id);
    expect(paths.length).toBe(2);
    expect(paths.every((p) => p[0] === zs.id && p[p.length - 1] === target.id)).toBe(true);
  });
});
