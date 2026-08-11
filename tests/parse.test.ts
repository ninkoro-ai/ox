import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/excel/parse';
import { makeGenericWorkbook, makeStructuredWorkbook } from './fixtures';

describe('Excel 解析', () => {
  it('识别分页式工商报告（一级/二级股东）', () => {
    const result = parseWorkbook(makeStructuredWorkbook());
    expect(result.format).toBe('structured-levels');
    expect(result.targetName).toBe('沧州旭阳化工有限公司');
    expect(result.relations.length).toBe(6); // 4 条一级 + 香港→旭阳 + 旭阳→邢台
    const lvl1 = result.relations.filter((r) => r.level === 1);
    expect(lvl1.length).toBe(4);
    const xy = lvl1.find((r) => r.investor.includes('旭阳集团'));
    expect(xy?.ratio).toBeCloseTo(80.48, 2);
    const hk = result.relations.find((r) => r.investor.includes('香港'));
    expect(hk?.level).toBe(2);
    expect(result.entityTypes['旭阳集团有限公司']).toContain('港澳台');
  });

  it('识别通用表格字段别名', () => {
    const result = parseWorkbook(makeGenericWorkbook());
    expect(result.format).toBe('generic-table');
    expect(result.relations.length).toBe(3);
    expect(result.relations[0].investor).toBe('甲公司');
    expect(result.relations[0].ratio).toBeCloseTo(60, 2);
    expect(result.relations[2].ratio).toBeCloseTo(80, 2);
    expect(result.relations[2].level).toBe(2);
  });

  it('比例格式化：百分号/不详/空值', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['股东名称', '持股比例', '被投资企业'],
        ['A公司', '100.00%', 'B公司'],
        ['C公司', '不详', 'B公司'],
        ['D公司', '-', 'B公司'],
      ]),
      '表',
    );
    const result = parseWorkbook(wb);
    expect(result.relations.map((r) => r.ratio)).toEqual([100, null, null]);
  });
});
