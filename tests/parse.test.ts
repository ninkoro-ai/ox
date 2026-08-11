import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { parseWorkbook } from '../src/lib/excel/parse';
import { createManualTemplateWorkbook } from '../src/lib/excel/template';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { fitLayout } from '../src/lib/layout/page';
import { checkLayout } from '../src/lib/layout/collision';
import { generatePptx } from '../src/lib/ppt/generatePptx';
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

  it('人工录入模板：下载 → 解析 → 穿透 → 布局 → PPT 全流程', async () => {
    // 生成模板并重新读入，模拟用户下载后填写再上传
    const buf = createManualTemplateWorkbook();
    const wb = XLSX.read(buf, { type: 'array' });
    const parsed = parseWorkbook(wb);
    expect(parsed.format).toBe('manual-template');
    expect(parsed.targetName).toBe('目标公司');
    expect(parsed.relations.length).toBe(3);
    expect(parsed.relations[0]).toMatchObject({ investor: '张三', investee: '目标公司', ratio: 40, level: 1 });
    expect(parsed.entityTypes['张三']).toBe('自然人');
    expect(parsed.entityProfiles?.[0]).toMatchObject({ name: '目标公司', isCreditSubject: true });

    // 与现有工商 Excel 共用后续流程：EquityGraph → Penetration → Layout → PPT
    const tree = buildEquityTree(
      parsed.targetName!,
      parsed.relations,
      parsed.entityTypes ?? {},
      { threshold: 25, stopAtNaturalPerson: true, stopAtOverseas: true, showBelowThreshold: true, maxLevel: 20, ratioPrecision: 2 },
    );
    expect(tree.nodes.find((n) => n.name === '张三')?.stopReason).toBe('natural-person');
    expect(tree.nodes.find((n) => n.name === '王五控股有限公司')?.level).toBe(2);

    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 5,
      autoMerge: true,
      showRegPlace: false,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);

    const ppt = (await generatePptx(
      {
        tree: fit.tree,
        layout: fit.layout,
        page: fit.page,
        pxToIn: fit.pxToIn,
        title: `${tree.targetName} 股权穿透结构图`,
        subtitle: '数据来源：人工录入模板',
        threshold: 25,
        mergeRatio: 5,
        mergedGroups: 0,
      },
      'nodebuffer',
    )) as Buffer;
    const zip = await JSZip.loadAsync(ppt);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('目标公司');
    expect(slideXml).toContain('张三');
    expect(slideXml.match(/<a:ext cx="-\d+|cy="-\d+/)).toBeNull();
  });
});
