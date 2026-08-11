import { describe, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/excel/parse';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { fitLayout } from '../src/lib/layout/page';

describe('inspect', () => {
  it('beilai bank-ownership', () => {
    const path = 'D:/uu/GameViewer/Download/深圳贝特莱电子科技股份有限公司_W6ff38750f30c84fbe4a9a2c7.xlsx';
    const wb = XLSX.readFile(path);
    const parsed = parseWorkbook(wb);
    // 这三家公司在原始数据中的全部持股边
    for (const name of ['苏州享科股权投资合伙企业（有限合伙）', '深圳宸矽创智投资企业（有限合伙）', '深圳宸鑫创富投资企业（有限合伙）']) {
      const rels = parsed.relations.filter((r) => r.investor.includes(name) || r.investee.includes(name));
      console.log('REL', name, '->', rels.map((r) => `${r.investor} -> ${r.investee} ${r.ratio}`).join(' | '));
    }
    const tree = buildEquityTree(parsed.targetName!, parsed.relations, parsed.entityTypes ?? {}, { threshold: 25, stopAtNaturalPerson: true, stopAtOverseas: true, showBelowThreshold: true, maxLevel: 20, ratioPrecision: 2 });
    for (const name of ['苏州享科股权投资合伙企业（有限合伙）', '深圳宸矽创智投资企业（有限合伙）', '深圳宸鑫创富投资企业（有限合伙）']) {
      const edges = tree.edges.filter((e) => {
        const f = tree.nodes.find((n) => n.id === e.fromId);
        const t = tree.nodes.find((n) => n.id === e.toId);
        return f?.name.includes(name) || t?.name.includes(name);
      });
      console.log('TREE-EDGES', name, '->', edges.map((e) => {
        const f = tree.nodes.find((n) => n.id === e.fromId)?.name;
        const t = tree.nodes.find((n) => n.id === e.toId)?.name;
        return `${f} -> ${t} ${e.ratio}`;
      }).join(' | '));
    }
    const fit = fitLayout(tree, { pageMode: 'auto', mergeRatio: 25, autoMerge: true, showRegPlace: false, mergeBelow: false, ratioPrecision: 2, layoutMode: 'bank-ownership' });
    const byId = new Map(fit.layout.nodes.map((n) => [n.id, n]));
    for (const name of ['苏州享科股权投资合伙企业（有限合伙）', '深圳宸矽创智投资企业（有限合伙）', '深圳宸鑫创富投资企业（有限合伙）']) {
      const node = fit.layout.nodes.find((n) => n.name.includes(name))!;
      const edges = fit.layout.edges.filter((e) => e.fromId === node.id);
      console.log('LAYOUT-EDGES', name, 'node x:', node.x.toFixed(0), 'w:', node.w.toFixed(0));
      for (const e of edges) {
        const to = byId.get(e.toId)!;
        const segs = (e.path ?? []).map((s) => `${s.kind}(${s.x1.toFixed(0)},${s.y1.toFixed(0)})->(${s.x2.toFixed(0)},${s.y2.toFixed(0)})${s.arrow ? '*' : ''}`);
        console.log('   ->', to.name, 'segs:', segs.join(' '));
      }
    }
  });
});
