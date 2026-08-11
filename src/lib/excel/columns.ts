// 字段别名识别：不依赖固定列名

export const INVESTOR_KEYS = [
  '股东名称',
  '股东',
  '投资人',
  '投资方',
  '出资人',
  '投资者',
  '股东姓名',
  '股东（出资人）',
];

export const INVESTEE_KEYS = [
  '被投资企业',
  '被投资公司',
  '被投资单位',
  '企业名称',
  '公司名称',
  '标的公司',
  '目标公司',
  '投资标的',
  '被投资方',
];

export const RATIO_KEYS = [
  '持股比例',
  '持股比例(%)',
  '持股比例（%）',
  '股权比例',
  '持股比',
  '出资比例',
  '股份比例',
  '占比',
  '比例',
];

export const LEVEL_KEYS = [
  '股东层级',
  '层级',
  '级数',
  '级别',
  '股东级别',
  'level',
  '层',
];

export function normalizeHeader(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')');
}

export function scoreHeader(header: unknown, keys: string[]): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const k of keys) {
    const nk = normalizeHeader(k);
    if (!nk) continue;
    if (h === nk) best = Math.max(best, 100);
    else if (h.includes(nk)) best = Math.max(best, 60);
    else if (nk.includes(h) && h.length >= 2) best = Math.max(best, 30);
  }
  return best;
}

export interface ColumnMapping {
  investor: string;
  investee: string;
  ratio: string;
  level: string;
}

/** 根据表头自动推断列映射 */
export function detectColumnMapping(headers: unknown[]): ColumnMapping | null {
  const roles: Array<keyof ColumnMapping> = ['investor', 'investee', 'ratio', 'level'];
  const keysByRole = {
    investor: INVESTOR_KEYS,
    investee: INVESTEE_KEYS,
    ratio: RATIO_KEYS,
    level: LEVEL_KEYS,
  };
  const chosen: Partial<Record<keyof ColumnMapping, number>> = {};

  for (let i = 0; i < headers.length; i++) {
    const scores = roles.map((r) => scoreHeader(headers[i], keysByRole[r]));
    const best = Math.max(...scores);
    if (best < 50) continue;
    const role = roles[scores.indexOf(best)];
    if (chosen[role] === undefined) chosen[role] = i;
    else {
      // 已有更早匹配时保留更早的列
      const prevScore = scoreHeader(headers[chosen[role]!], keysByRole[role]);
      if (best > prevScore) chosen[role] = i;
    }
  }

  if (chosen.investor === undefined) return null;
  if (chosen.investee === undefined && chosen.level === undefined) return null;

  return {
    investor: String(headers[chosen.investor] ?? ''),
    investee: chosen.investee !== undefined ? String(headers[chosen.investee] ?? '') : '',
    ratio: chosen.ratio !== undefined ? String(headers[chosen.ratio] ?? '') : '',
    level: chosen.level !== undefined ? String(headers[chosen.level] ?? '') : '',
  };
}
