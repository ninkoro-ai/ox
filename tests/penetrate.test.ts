import { describe, expect, it } from 'vitest';
import type { EquityRelation } from '../src/lib/types';
import { buildEquityTree } from '../src/lib/graph/penetrate';

const OPTS = {
  threshold: 25,
  stopAtNaturalPerson: true,
  stopAtOverseas: true,
  showBelowThreshold: true,
  maxLevel: 20,
  ratioPrecision: 2,
};

function tree(relations: EquityRelation[], opts = OPTS) {
  return buildEquityTree('目标公司', relations, {}, opts);
}

describe('银行授信股权穿透规则', () => {
  it('第一层直接股东全部展示', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: 'B公司', investee: '目标公司', ratio: 0.01 },
    ]);
    expect(t.nodes.filter((n) => n.level === 1).length).toBe(2);
  });

  it('第一层超 25% 的控制链持续穿透，直至境外公司或个人股东', () => {
    const t = tree([
      { investor: '旭阳集团', investee: '目标公司', ratio: 80 },
      { investor: 'A公司', investee: '旭阳集团', ratio: 60 },
      { investor: 'B公司', investee: '旭阳集团', ratio: 20 },
      { investor: 'C公司', investee: 'B公司', ratio: 100 },
      { investor: '张三', investee: 'A公司', ratio: 100 },
    ]);
    const a = t.nodes.find((n) => n.name === 'A公司');
    const b = t.nodes.find((n) => n.name === 'B公司');
    expect(a?.stopReason).toBe('expanded');
    // B 虽仅持 20%，但在超 25% 的控制链上，继续向上穿透至其股东
    expect(b?.stopReason).toBe('expanded');
    expect(t.nodes.find((n) => n.name === 'C公司')?.level).toBe(3);
    // 自然人停止穿透
    expect(t.nodes.find((n) => n.name === '张三')?.stopReason).toBe('natural-person');
  });

  it('文本框内不显示任何停止标签，仅保留主体名称', () => {
    const t = tree([
      { investor: '旭阳集团有限公司', investee: '目标公司', ratio: 80 },
      { investor: '自然人张三', investee: '目标公司', ratio: 30 },
      { investor: '香港控股有限公司', investee: '目标公司', ratio: 10 },
    ]);
    for (const n of t.nodes) {
      expect(n.tag).toBeUndefined();
    }
  });

  it('第一层等于阈值（25%）不触发控制链；超过阈值才继续穿透', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: 'B公司', investee: '目标公司', ratio: 25 },
      { investor: 'C公司', investee: 'A公司', ratio: 26 },
      { investor: 'D公司', investee: 'C公司', ratio: 100 },
    ]);
    expect(t.nodes.find((n) => n.name === 'B公司')?.stopReason).toBe('below-threshold');
    expect(t.nodes.find((n) => n.name === 'C公司')?.stopReason).toBe('expanded');
  });

  it('超 25% 控制链向上穿透直至个人股东（贝特莱案例）', () => {
    const t = tree([
      { investor: '探路者控股集团股份有限公司', investee: '目标公司', ratio: 51 },
      { investor: '北京通域高精尖股权投资中心（有限合伙）', investee: '探路者控股集团股份有限公司', ratio: 7.8 },
      { investor: '张三', investee: '北京通域高精尖股权投资中心（有限合伙）', ratio: 60 },
      { investor: '李四', investee: '北京通域高精尖股权投资中心（有限合伙）', ratio: 40 },
    ]);
    const bj = t.nodes.find((n) => n.name.includes('北京通域'))!;
    expect(bj.stopReason).toBe('expanded');
    expect(t.nodes.find((n) => n.name === '张三')?.level).toBe(3);
    expect(t.nodes.find((n) => n.name === '张三')?.stopReason).toBe('natural-person');
    expect(t.nodes.find((n) => n.name === '李四')?.level).toBe(3);
  });

  it('重复股东只列示一次，并补充完整持股路径', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 60 },
      { investor: 'C公司', investee: 'A公司', ratio: 40 },
      { investor: 'B公司', investee: '目标公司', ratio: 30 },
      { investor: 'C公司', investee: 'B公司', ratio: 100 },
    ]);
    expect(t.nodes.filter((n) => n.name === 'C公司').length).toBe(1);
    const c = t.nodes.find((n) => n.name === 'C公司')!;
    const cEdges = t.edges.filter((e) => e.fromId === c.id);
    expect(cEdges.length).toBe(2);
    expect(new Set(cEdges.map((e) => e.toId)).size).toBe(2);
    expect(c.level).toBe(2);
  });

  it('第一层直接股东持股大于 25% 必须向上穿透', () => {
    const t = tree([
      { investor: '旭阳集团有限公司', investee: '目标公司', ratio: 80.48 },
      { investor: '中國旭陽集團（香港）有限公司', investee: '旭阳集团有限公司', ratio: 100 },
      { investor: '低比例股东', investee: '目标公司', ratio: 20 },
    ]);
    const xy = t.nodes.find((n) => n.name === '旭阳集团有限公司');
    expect(xy?.stopReason).toBe('expanded');
    expect(t.nodes.find((n) => n.name.includes('香港'))?.level).toBe(2);
    expect(t.nodes.find((n) => n.name === '低比例股东')?.stopReason).toBe('below-threshold');
  });

  it('第一层股东全部展示，超25%控制链不受 showBelowThreshold 影响', () => {
    const t = tree(
      [
        { investor: 'A公司', investee: '目标公司', ratio: 80 },
        { investor: 'B公司', investee: '目标公司', ratio: 20 },
        { investor: 'C公司', investee: 'A公司', ratio: 10 },
      ],
      { ...OPTS, showBelowThreshold: false },
    );
    expect(t.nodes.find((n) => n.name === 'B公司')).toBeDefined(); // 第一层全部展示
    expect(t.nodes.find((n) => n.name === 'A公司')).toBeDefined();
    expect(t.nodes.find((n) => n.name === 'C公司')).toBeDefined(); // 控制链内继续穿透
  });

  it('自然人停止穿透', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: '汤玉祥', investee: 'A公司', ratio: 99 },
    ]);
    expect(t.nodes.find((n) => n.name === '汤玉祥')?.stopReason).toBe('natural-person');
  });

  it('“自然人投资或控股”是公司类型，不作为自然人处理，超过阈值继续穿透', () => {
    const t = tree([
      { investor: '探路者控股集团股份有限公司', investee: '目标公司', ratio: 51 },
      { investor: '北京通域高精尖股权投资中心（有限合伙）', investee: '探路者控股集团股份有限公司', ratio: 7.8 },
    ]);
    const tlz = t.nodes.find((n) => n.name === '探路者控股集团股份有限公司')!;
    expect(tlz.stopReason).toBe('expanded');
    expect(t.nodes.find((n) => n.name.includes('北京通域'))?.level).toBe(2);
    const t2 = buildEquityTree(
      '目标公司',
      [{ investor: '某股份有限公司', investee: '目标公司', ratio: 60 }],
      { '某股份有限公司': '股份有限公司(上市、自然人投资或控股)' },
      OPTS,
    );
    expect(t2.nodes.find((n) => n.name === '某股份有限公司')?.stopReason).not.toBe('natural-person');
  });

  it('境外公司停止穿透（香港/BVI/Limited）', () => {
    const cases: Array<[string, string | undefined]> = [
      ['中國旭陽集團（香港）有限公司', '香港'],
      ['BVI Alpha Ltd', '英属维尔京群岛'],
      ['Hong Kong Holdings Limited', '香港'],
    ];
    for (const [name, regPlace] of cases) {
      const t = tree([
        { investor: 'A公司', investee: '目标公司', ratio: 80 },
        { investor: name, investee: 'A公司', ratio: 100 },
      ]);
      expect(t.nodes.find((n) => n.name === name)?.stopReason).toBe('overseas');
      expect(t.nodes.find((n) => n.name === name)?.regPlace).toBe(regPlace);
    }
  });

  it('繁体字公司名默认按境外主体处理，注册地默认香港', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: '遠東國際控股有限公司', investee: 'A公司', ratio: 100 },
    ]);
    const node = t.nodes.find((n) => n.name === '遠東國際控股有限公司');
    expect(node?.stopReason).toBe('overseas');
    expect(node?.regPlace).toBe('香港');
  });

  it('自然人节点不显示注册地', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: '汤玉祥', investee: 'A公司', ratio: 99 },
    ]);
    expect(t.nodes.find((n) => n.name === '汤玉祥')?.regPlace).toBeUndefined();
  });

  it('持股比例精度可调，默认两位小数', () => {
    const rel: EquityRelation[] = [
      { investor: 'A公司', investee: '目标公司', ratio: 80.5 },
      { investor: 'B公司', investee: '目标公司', ratio: 5.3 },
    ];
    const t2 = tree(rel);
    expect(t2.nodes.find((n) => n.name === 'A公司')?.ratioText).toBe('80.50%');
    expect(t2.nodes.find((n) => n.name === 'B公司')?.ratioText).toBe('5.30%');
    const t3 = tree(rel, { ...OPTS, ratioPrecision: 3 });
    expect(t3.nodes.find((n) => n.name === 'A公司')?.ratioText).toBe('80.500%');
    const t0 = tree(rel, { ...OPTS, ratioPrecision: 0 });
    expect(t0.nodes.find((n) => n.name === 'A公司')?.ratioText).toBe('81%');
  });

  it('股比不详按未穿透处理', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: '某有限合伙', investee: 'A公司', ratio: null },
    ]);
    expect(t.nodes.find((n) => n.name === '某有限合伙')?.stopReason).toBe('unknown-ratio');
  });

  it('无股东信息时标记叶子', () => {
    const t = tree([{ investor: '农银金融资产投资有限公司', investee: '目标公司', ratio: 60 }]);
    expect(t.nodes.find((n) => n.name.startsWith('农银'))?.stopReason).toBe('no-shareholders');
  });

  it('防环：A→B→A 自动截断', () => {
    const t = tree([
      { investor: 'A公司', investee: '目标公司', ratio: 80 },
      { investor: 'B公司', investee: 'A公司', ratio: 60 },
      { investor: 'A公司', investee: 'B公司', ratio: 90 },
    ]);
    expect(t.warnings.some((w) => w.includes('循环'))).toBe(true);
    expect(t.nodes.filter((n) => n.name === 'A公司').length).toBe(1);
  });
});
