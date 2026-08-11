import { readdirSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/excel/parse';

const file = readdirSync(process.cwd()).find((f) => f.toLowerCase().endsWith('.xlsx'));
if (!file) {
  console.log('no xlsx found');
  process.exit(0);
}
const wb = XLSX.readFile(file);
const p = parseWorkbook(wb);
console.log('target:', p.targetName);
console.log('format:', p.format);
console.log('relations:', p.relations.length);
const byLevel = new Map<number, number>();
for (const r of p.relations) {
  const l = r.level ?? 0;
  byLevel.set(l, (byLevel.get(l) ?? 0) + 1);
}
console.log(
  'byLevel:',
  Object.fromEntries([...byLevel.entries()].sort((a, b) => a[0] - b[0])),
);
console.log('warnings:', p.warnings);
