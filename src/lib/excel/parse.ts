import * as XLSX from 'xlsx';
import type { EquityRelation, ParsedResult, SheetFormat } from '../types';
import { detectColumnMapping, scoreHeader, INVESTOR_KEYS, INVESTEE_KEYS, RATIO_KEYS, LEVEL_KEYS } from './columns';
import { parseRatio } from './ratio';

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
};

const LEVEL_SHEET_RE = /^(第?)([一二三四五六七八九十百]+|\d+)\s*(级股东|层股东|级|层)/;

function cnToNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  let sum = 0;
  let section = 0;
  for (const ch of token) {
    const v = CN_NUM[ch];
    if (v === undefined) return null;
    if (ch === '十' || ch === '百') {
      if (section === 0) section = 1;
      sum += section * v;
      section = 0;
    } else {
      section = v;
    }
  }
  sum += section;
  return sum || null;
}

export function parseLevelFromSheetName(name: string): number | null {
  const m = name.trim().match(LEVEL_SHEET_RE);
  if (!m) return null;
  return cnToNumber(m[2]);
}

function parseLevelValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^第?([一二三四五六七八九十百]+|\d+)\s*(级|层)/);
  if (m) return cnToNumber(m[1]);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function isShareholderHeader(a: string): boolean {
  return a.includes('股东名称') || a === '股东' || a === '投资人' || a === '投资方' || a === '股东姓名' || a === '出资人';
}

/** 解析“一级股东/二级股东……”分页式工商报告 */
function parseStructuredSheet(
  sheet: XLSX.WorkSheet,
  level: number,
  relations: EquityRelation[],
  entityTypes: Record<string, string>,
  targetCandidates: string[],
) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  let block: string | null = null;
  let lastBlockCandidate: string | null = null;
  let blockType: string | null = null;
  let inTable = false;
  let ratioIdx = 4;

  const nextNonEmpty = (from: number): string => {
    for (let j = from; j < rows.length; j++) {
      const a = clean(rows[j][0]);
      if (a) return a;
    }
    return '';
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.map((c) => (typeof c === 'string' ? c.trim() : c));
    const a = clean(cells[0]);
    const rest = cells
      .slice(1)
      .map((c) => clean(c))
      .filter(Boolean);

    if (a && isShareholderHeader(a)) {
      inTable = true;
      let found = -1;
      for (let i = 1; i < cells.length; i++) {
        const h = clean(cells[i]);
        if (h.includes('比例') || h.includes('持股')) {
          found = i;
          break;
        }
      }
      ratioIdx = found > 0 ? found : 4;
      continue;
    }

    if (a === '企业类型') {
      blockType = clean(cells[1]) || null;
      if (lastBlockCandidate && blockType) entityTypes[lastBlockCandidate] = blockType;
      continue;
    }

    if (a === '无股东信息' || a === '无股东' || a === '暂无股东信息') {
      inTable = false;
      continue;
    }

    if (a === '风险情况') {
      continue;
    }

    if (a === '控制路径') {
      if (lastBlockCandidate) block = lastBlockCandidate;
      inTable = false;
      continue;
    }

    const onlyACell = rest.length === 0;
    if (onlyACell && a) {
      if (/^第[一二三四五六七八九十百\d]+级股东信息$/.test(a)) continue;
      if (a.includes('股东名称') || isShareholderHeader(a)) {
        inTable = true;
        continue;
      }
      if (inTable) {
        // 表格中的稀疏数据行（仅名称）与“新区块”难以区分：
        // 新区块之后必然跟着 企业类型/风险情况/控制路径，用下一行锚点判断
        const next = nextNonEmpty(i + 1);
        if (next === '企业类型' || next === '风险情况' || next === '控制路径') {
          block = a;
          lastBlockCandidate = a;
          blockType = entityTypes[a] ?? null;
          inTable = false;
          if (level === 1) targetCandidates.push(a);
          continue;
        }
        // 否则视为稀疏数据行
        if (block && a !== block) {
          relations.push({
            investor: a,
            investee: block,
            ratio: null,
            level,
            sourceSheet: `第${level}级`,
          });
        }
        continue;
      }
      // 新的区块开始（区块公司 = 被投资企业）
      block = a;
      lastBlockCandidate = a;
      blockType = entityTypes[a] ?? null;
      inTable = false;
      if (level === 1) targetCandidates.push(a);
      continue;
    }

    // 股东数据行
    if (inTable && a) {
      const investor = a;
      const ratio = parseRatio(cells[ratioIdx]);
      if (investor && investor !== '-' && block && investor !== block) {
        relations.push({
          investor,
          investee: block,
          ratio,
          level,
          sourceSheet: `第${level}级`,
          investorType: clean(cells[1]) || undefined,
          investeeType: blockType ?? undefined,
        });
      }
    }
  }
}

/** 解析通用平铺表格（股东名称/持股比例/被投资企业/层级） */
function parseGenericSheet(
  sheet: XLSX.WorkSheet,
  relations: EquityRelation[],
  warnings: string[],
  entityTypes: Record<string, string>,
): { sheet: string; ok: boolean } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  let headerIdx = -1;
  let mapping: ReturnType<typeof detectColumnMapping> | null = null;

  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const m = detectColumnMapping(rows[i]);
    if (m) {
      headerIdx = i;
      mapping = m;
      break;
    }
  }
  if (!mapping) return { sheet: '', ok: false };

  const colOf = (header: string): number => rows[headerIdx].findIndex((c) => clean(c) === header);
  const invIdx = colOf(mapping.investor);
  const invteeIdx = mapping.investee ? colOf(mapping.investee) : -1;
  const ratioIdx = mapping.ratio ? colOf(mapping.ratio) : -1;
  const levelIdx = mapping.level ? colOf(mapping.level) : -1;

  let typeIdx = -1;
  for (let i = 0; i < rows[headerIdx].length; i++) {
    const h = clean(rows[headerIdx][i]);
    if (h.includes('股东类型') || h === '企业类型') {
      typeIdx = i;
      break;
    }
  }

  let count = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const investor = clean(row[invIdx]);
    if (!investor || investor === '-') continue;
    const maybeHeader = detectColumnMapping(row);
    if (maybeHeader) break; // 遇到下一个表头停止
    const investee = invteeIdx >= 0 ? clean(row[invteeIdx]) : '';
    const ratio = ratioIdx >= 0 ? parseRatio(row[ratioIdx]) : null;
    const level = levelIdx >= 0 ? parseLevelValue(row[levelIdx]) : undefined;
    if (!investee) {
      warnings.push(`第 ${i + 1} 行缺少被投资企业，已跳过：${investor}`);
      continue;
    }
    relations.push({
      investor,
      investee,
      ratio,
      level: level ?? undefined,
      investorType: typeIdx >= 0 ? clean(row[typeIdx]) || undefined : undefined,
    });
    count++;
  }
  if (count === 0) {
    warnings.push('识别到表头但未读取到有效数据行');
  }
  return { sheet: '', ok: count > 0 };
}

function detectTarget(
  wb: XLSX.WorkBook,
  relations: EquityRelation[],
  targetCandidates: string[],
): string | null {
  // 1. 概要页“企业名称”
  const summary = wb.Sheets['概要'] ?? wb.Sheets['概览'];
  if (summary) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(summary, { header: 1, defval: '' });
    for (const row of rows) {
      if (clean(row[0]) === '企业名称' && clean(row[1])) return clean(row[1]);
    }
  }
  // 2. 一级股东页的区块公司
  if (targetCandidates.length) {
    const counts = new Map<string, number>();
    for (const c of targetCandidates) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best = '';
    let bestN = 0;
    for (const [k, v] of counts) {
      if (v > bestN) {
        best = k;
        bestN = v;
      }
    }
    if (best) return best;
  }
  // 3. 通用模式：level=1 的被投资企业，其次出现次数最多的被投资企业
  const level1 = relations.filter((r) => r.level === 1 && r.investee);
  const freq = new Map<string, number>();
  for (const r of level1.length ? level1 : relations) {
    freq.set(r.investee, (freq.get(r.investee) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [k, v] of freq) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best || null;
}

function dedupeRelations(relations: EquityRelation[]): EquityRelation[] {
  const seen = new Set<string>();
  const out: EquityRelation[] = [];
  for (const r of relations) {
    const key = `${r.investor}\u0000${r.investee}\u0000${r.ratio ?? 'null'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function parseWorkbook(wb: XLSX.WorkBook): ParsedResult {
  const relations: EquityRelation[] = [];
  const warnings: string[] = [];
  const entityTypes: Record<string, string> = {};
  const targetCandidates: string[] = [];
  const sheetNames = wb.SheetNames.map((n) => n.trim());

  const levelSheets = sheetNames
    .map((name) => ({ name, ws: wb.Sheets[name], level: parseLevelFromSheetName(name) }))
    .filter((s): s is { name: string; ws: XLSX.WorkSheet; level: number } => s.level !== null)
    .sort((a, b) => a.level - b.level);

  let format: SheetFormat = 'generic-table';
  if (levelSheets.length > 0) {
    format = 'structured-levels';
    for (const s of levelSheets) {
      parseStructuredSheet(s.ws, s.level, relations, entityTypes, targetCandidates);
    }
  }

  const structuredNames = new Set(levelSheets.map((s) => s.name));
  for (const name of sheetNames) {
    if (structuredNames.has(name)) continue;
    if (name === '概要' || name === '概览') continue;
    parseGenericSheet(wb.Sheets[name], relations, warnings, entityTypes);
  }

  const before = relations.length;
  const deduped = dedupeRelations(relations);
  if (deduped.length < before) {
    warnings.push(`已合并 ${before - deduped.length} 条重复股权关系`);
  }

  const targetName = detectTarget(wb, deduped, targetCandidates);
  if (deduped.length === 0) {
    warnings.push('未识别到任何股权关系，请检查文件是否为工商股权结构报告');
  }
  if (!targetName) {
    warnings.push('未能自动识别目标企业，请确认文件包含企业名称');
  }

  return {
    targetName,
    relations: deduped,
    sheets: sheetNames,
    format,
    warnings,
    entityTypes,
  };
}
