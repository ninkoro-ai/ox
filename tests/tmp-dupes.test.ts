import { describe, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/excel/parse';
import { buildEquityTree } from '../src/lib/graph/penetrate';

describe('tmp dupes', () => {
  it('counts duplicate entities in hengda and cangzhou', () => {
    for (const path of [
      'C:/Users/Administrator/Desktop/恒大地产集团有限公司_W7c12787be4b666e99a389765.xlsx',
      'F:/OX-demo/用户上传示例-沧州旭阳化工有限公司_W242d75709d5f3e47a6c6f3ad.xlsx',
    ]) {
      const wb = XLSX.readFile(path);
      const parsed = parseWorkbook(wb);
      const tree = buildEquityTree(
        parsed.targetName!,
        parsed.relations,
        parsed.entityTypes ?? {},
        { threshold: 0, stopAtNaturalPerson: false, stopAtOverseas: false, showBelowThreshold: true, maxLevel: 50, ratioPrecision: 2 },
      );
      const byName = new Map<string, string[]>();
      for (const n of tree.nodes) {
        const list = byName.get(n.name) ?? [];
        list.push(`L${n.level}`);
        byName.set(n.name, list);
      }
      const dupes = [...byName.entries()].filter(([, lv]) => lv.length > 1);
      console.log('FILE', path.split('/').pop());
      console.log('  nodes', tree.nodes.length, 'dupes', dupes.length, 'maxLevel', tree.stats.maxLevel);
      for (const [name, lv] of dupes.slice(0, 12)) {
        console.log('  DUP', JSON.stringify(name), lv.join(','));
      }
    }
  });
});
