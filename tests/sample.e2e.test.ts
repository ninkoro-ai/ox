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
import { EDGE_CROSS_COLORS } from '../src/lib/theme';
import { textWidth } from '../src/lib/layout/measure';

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
    // 纵向版式下简单结构可能为 A4 或 A3，二者均可
    expect(['a4', 'a3']).toContain(fit.page);
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
    // OOXML 规范要求 a:ext 的 cx/cy >= 0；负数尺寸会让 PowerPoint 弹修复提示
    expect(slideXml.match(/<a:ext cx="-\d+|cy="-\d+/)).toBeNull();
    // 所有文本对象都应为标准文本框（txBox="1"），保证可整体拖动二次编辑
    const txBoxCount = (slideXml.match(/txBox="1"/g) || []).length;
    const txBodyCount = (slideXml.match(/<p:txBody>/g) || []).length;
    expect(txBoxCount).toBe(txBodyCount);
    expect(txBoxCount).toBeGreaterThan(0);
    // 公司节点为单个带边框文本框：所有圆角矩形均内嵌文字，无独立空形状
    const sps = slideXml.split('<p:sp>').slice(1);
    const roundRects = sps.filter((sp) => sp.includes('prstGeom prst="roundRect"'));
    expect(roundRects.length).toBeGreaterThanOrEqual(6);
    expect(roundRects.every((sp) => sp.includes('<p:txBody>'))).toBe(true);
    const relsXml = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('text');
    expect(relsXml).not.toContain('image'); // 禁止图片插入
  }, 180000);
});

const BEILAI = 'D:/uu/GameViewer/Download/深圳贝特莱电子科技股份有限公司_W6ff38750f30c84fbe4a9a2c7.xlsx';
describe.skipIf(!existsSync(BEILAI))('复杂股权图（贝特莱）验收', () => {
  it('每个层级标注比例、标签不遮线、交叉线自动着色、无负数尺寸', async () => {
    const wb = XLSX.readFile(BEILAI);
    const parsed = parseWorkbook(wb);
    const tree = buildEquityTree(
      parsed.targetName!,
      parsed.relations,
      parsed.entityTypes ?? {},
      { threshold: 25, stopAtNaturalPerson: true, stopAtOverseas: true, showBelowThreshold: true, maxLevel: 20, ratioPrecision: 2 },
    );
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 25,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: false,
      ratioPrecision: 2,
      textLayout: 'horizontal',
    });
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.segmentNodeHits).toBe(0);
    expect(report.labelNodeHits).toBe(0);
    expect(report.labelOverlaps).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    // 每个有比例的持股关系都必须标注
    const edgeTexts = fit.layout.edges.filter((e) => e.label && e.label !== '—' && e.label !== '不详');
    const labelIds = new Set(fit.layout.labels.map((l) => l.edgeId));
    for (const e of edgeTexts) expect(labelIds.has(e.fromId)).toBe(true);
    // 标签在线两侧分布
    expect(fit.layout.labels.some((l) => l.side === 'left')).toBe(true);
    expect(fit.layout.labels.some((l) => l.side === 'right')).toBe(true);
    // 交叉/重叠线段使用调色板颜色（区分色），且同一路径同色
    for (const s of fit.layout.segments) {
      if (s.color) expect(EDGE_CROSS_COLORS).toContain(s.color);
    }
    const coloredByEdge = new Map<string, Set<string>>();
    for (const s of fit.layout.segments) {
      if (!s.color) continue;
      const set = coloredByEdge.get(s.edgeId) ?? new Set<string>();
      set.add(s.color);
      coloredByEdge.set(s.edgeId, set);
    }
    for (const set of coloredByEdge.values()) expect(set.size).toBe(1);

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
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml.match(/<a:ext cx="-\d+|cy="-\d+/)).toBeNull();
    const txBoxCount = (slideXml.match(/txBox="1"/g) || []).length;
    const txBodyCount = (slideXml.match(/<p:txBody>/g) || []).length;
    expect(txBoxCount).toBe(txBodyCount);
    // 区分色确实写入 PPT
    for (const c of [...coloredByEdge.values()].map((s) => [...s][0])) {
      expect(slideXml).toContain(`val="${c}"`);
    }
    const outDir = join(ROOT, 'out');
    writeFileSync(join(outDir, '深圳贝特莱电子科技股份有限公司-股权穿透结构图-最终版.pptx'), buf);
    writeFileSync(
      join(outDir, 'preview-beilai.html'),
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${renderChartSvg(
        fit.layout,
        25,
      )}</body></html>`,
    );
  }, 180000);

  it('合并阈值 3% 时文字不超出文本框、比例标签不重叠', async () => {
    const wb = XLSX.readFile(BEILAI);
    const parsed = parseWorkbook(wb);
    const tree = buildEquityTree(
      parsed.targetName!,
      parsed.relations,
      parsed.entityTypes ?? {},
      { threshold: 25, stopAtNaturalPerson: true, stopAtOverseas: true, showBelowThreshold: true, maxLevel: 20, ratioPrecision: 2 },
    );
    const fit = fitLayout(tree, {
      pageMode: 'auto',
      mergeRatio: 3,
      autoMerge: true,
      showRegPlace: true,
      mergeBelow: true,
      ratioPrecision: 2,
      textLayout: 'horizontal',
    });
    // 密集图自动使用 A3 大版面（仅保留 A4/A3 自动适配）
    expect(fit.page).toBe('a3');
    const report = checkLayout(fit.layout);
    expect(report.nodeOverlaps).toBe(0);
    expect(report.labelNodeHits).toBe(0);
    expect(report.labelOverlaps).toBe(0);
    expect(report.labelSegmentHits).toBe(0);
    // 节点文字按 PPTX 同款字号算法估算，必须不超出文本框
    for (const n of fit.layout.nodes) {
      const wIn = n.w * fit.pxToIn;
      const hIn = n.h * fit.pxToIn;
      const wLimit = Math.min(
        ...n.lines.map((l) => {
          const bw = textWidth(l, 13);
          return bw > 0 ? (wIn * 72) / (bw * 13 * 0.0075) : 99;
        }),
      );
      const hLimit = (hIn * 72) / (n.lines.length * 1.35);
      const font = Math.min(13 * fit.pxToIn * 72, wLimit, hLimit);
      const needW = Math.max(...n.lines.map((l) => ((textWidth(l, 13) * font) / 13) * 0.75));
      const needH = n.lines.length * font * 1.35;
      expect(needW).toBeLessThanOrEqual(wIn * 72 + 0.5);
      expect(needH).toBeLessThanOrEqual(hIn * 72 + 0.5);
    }
    // 比例标签文字必须不超出标签框（容量自适应字号）
    for (const l of fit.layout.labels) {
      const baseW = textWidth(l.text, 10);
      const maxPt = l.w * fit.pxToIn * 72;
      const font = Math.min(Math.max(8, Math.min(40, 11 * fit.pxToIn * 72)), maxPt / (baseW * 0.075));
      const needW = ((baseW * font) / 10) * 0.75;
      expect(needW).toBeLessThanOrEqual(maxPt + 0.5);
    }
    const buf = (await generatePptx(
      {
        tree: fit.tree,
        layout: fit.layout,
        page: fit.page,
        pxToIn: fit.pxToIn,
        title: `${tree.targetName} 股权穿透结构图`,
        subtitle: `数据来源：工商股权结构报告 · 穿透阈值 25% · 合并阈值 3%`,
        threshold: 25,
        mergeRatio: 3,
        mergedGroups: fit.mergedGroups,
      },
      'nodebuffer',
    )) as Buffer;
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml.match(/<a:ext cx="-\d+|cy="-\d+/)).toBeNull();
  }, 180000);
});
