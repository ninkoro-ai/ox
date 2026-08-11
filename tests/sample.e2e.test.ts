import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { parseWorkbook } from '../src/lib/excel/parse';
import { buildEquityTree } from '../src/lib/graph/penetrate';
import { fitLayout } from '../src/lib/layout/page';
import { checkLayout } from '../src/lib/layout/collision';
import { generatePptx } from '../src/lib/ppt/generatePptx';
import { renderChartSvg } from '../src/lib/preview/svg';

const ROOT = process.cwd();

function findSample(): string | null {
  const files = readdirSync(ROOT);
  const xlsx = files.filter((f) => f.toLowerCase().endsWith('.xlsx'));
  return xlsx.length ? join(ROOT, xlsx[0]) : null;
}

describe.skipIf(!findSample())('真实工商 Excel 全流程验收', () => {
  const path = findSample()!;

  it('解析 → 穿透 → 布局 → 生成可编辑 PPT', async () => {
    const wb = XLSX.readFile(path);
    const parsed = parseWorkbook(wb);
    expect(parsed.format).toBe('structured-levels');
    expect(parsed.targetName).toBe('沧州旭阳化工有限公司');

    const lvl1 = parsed.relations.filter((r) => r.level === 1);
    expect(lvl1.length).toBe(4);
    const xy = lvl1.find((r) => r.investor.includes('旭阳集团'));
    expect(xy?.ratio).toBeCloseTo(80.48, 2);

    const tree = buildEquityTree(
      parsed.targetName!,
      parsed.relations,
      parsed.entityTypes ?? {},
      {
        threshold: 25,
        stopAtNaturalPerson: true,
        stopAtOverseas: true,
        showBelowThreshold: true,
        maxLevel: 20,
        ratioPrecision: 2,
      },
    );
    // 目标 + 4 个一级股东 + 旭阳集团股东（香港公司）
    expect(tree.nodes.length).toBe(6);
    const hk = tree.nodes.find((n) => n.name.includes('香港'));
    expect(hk?.stopReason).toBe('overseas');
    expect(tree.nodes.find((n) => n.name.includes('旭阳集团'))?.stopReason).toBe('expanded');

    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
    });
    expect(fit.page).toBe('a4');
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.segmentCrossings).toBe(0);
    expect(report.labelNodeHits).toBe(0);
    expect(report.labelOverlaps).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    // 目标主体汇总只保留一个箭头；境外股东与目标之间应有分隔虚线
    const entryArrows = fit.layout.segments.filter((s) => s.kind === 'entry' && s.arrow);
    expect(entryArrows.length).toBe(2); // 香港→旭阳集团、总线→目标
    expect(fit.layout.boundary).not.toBeNull();

    const buf = (await generatePptx(
      {
        tree: fit.tree,
        layout: fit.layout,
        page: fit.page,
        pxToIn: fit.pxToIn,
        title: `${tree.targetName} 股权穿透结构图`,
        subtitle: `数据来源：工商股权结构报告 · 穿透阈值 25%`,
        threshold: 25,
        mergeRatio: 25,
        mergedGroups: 0,
      },
      'nodebuffer',
    )) as Buffer;
    expect(buf.length).toBeGreaterThan(1000);

    const outDir = join(ROOT, 'out');
    if (!existsSync(outDir)) mkdirSync(outDir);
    const outPath = join(outDir, `${tree.targetName}-股权穿透结构图.pptx`);
    writeFileSync(outPath, buf);
    writeFileSync(
      join(outDir, 'preview.html'),
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${renderChartSvg(
        fit.layout,
        25,
      )}</body></html>`,
    );

    // 解包验证：形状、文字、箭头均为可编辑元素而非图片
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('prstGeom');
    expect(slideXml).toContain('沧州旭阳化工有限公司');
    expect(slideXml).toContain('旭阳集团有限公司');
    expect(slideXml).toContain('tailEnd type="triangle"'); // 箭头
    expect(slideXml).toContain('境外'); // 分隔虚线标签
    expect(slideXml).toContain('境内');
    expect(slideXml.match(/tailEnd type="triangle"/g)).toHaveLength(2); // 仅保留两个箭头
    expect(slideXml).toContain('prstDash'); // 虚线分隔线
    expect(slideXml).toContain('注册地：香港');
    expect(slideXml).toContain('注册地：中国');
    expect(slideXml).not.toContain('未穿透');
    // 公司节点为单个带边框文本框：所有圆角矩形均内嵌文字，无独立空形状
    const sps = slideXml.split('<p:sp>').slice(1);
    const roundRects = sps.filter((sp) => sp.includes('prstGeom prst="roundRect"'));
    expect(roundRects.length).toBeGreaterThanOrEqual(6);
    expect(roundRects.every((sp) => sp.includes('<p:txBody>'))).toBe(true);
    const relsXml = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('text');
    expect(relsXml).not.toContain('image'); // 禁止图片插入
  }, 180000);
});
