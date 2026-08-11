// 持股比例规范化：'80.48%' -> 80.48；'不详'/'-' -> null

export function parseRatio(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || s === '-' || s === '—') return null;
  if (/不详|未知|未披露|不适用|暂无|无/i.test(s)) return null;
  s = s.replace(/%/g, '').replace(/,/g, '').replace(/[（(].*?[）)]/g, '').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function formatRatio(r: number | null, precision = 2): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '不详';
  return `${formatNum(r, precision)}%`;
}

export function formatNum(n: number, precision = 2): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(precision);
}
