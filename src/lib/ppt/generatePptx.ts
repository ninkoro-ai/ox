import PptxGenJS from 'pptxgenjs';
import type { EquityTree, LayoutResult, PageKey } from '../types';
import { PAGES } from '../layout/page';
import { REG_PREFIX, textWidth } from '../layout/measure';
import { BOUNDARY_COLOR, EDGE_COLOR, NODE_BORDER, NODE_TEXT, TAG_TEXT } from '../theme';

export interface GeneratePptOptions {
  tree: EquityTree;
  layout: LayoutResult;
  page: PageKey;
  pxToIn: number;
  title: string;
  subtitle: string;
  threshold: number;
  mergeRatio: number;
  mergedGroups: number;
}

const AREA_LEFT_IN = 0.55;
const AREA_TOP_IN = 1.18;

type PptBuffer = Blob | Buffer;

export async function generatePptx(
  opts: GeneratePptOptions,
  outputType: 'blob' | 'nodebuffer' = 'blob',
): Promise<PptBuffer> {
  const pptx = new PptxGenJS();
  const page = PAGES[opts.page];
  pptx.defineLayout({ name: 'CUSTOM', width: page.wIn, height: page.hIn });
  pptx.layout = 'CUSTOM';
  pptx.author = '股权穿透结构图生成器';
  pptx.company = '股权穿透结构图生成器';
  pptx.subject = '股权穿透结构图';

  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };

  // 标题与副标题
  slide.addText(opts.title, {
    x: 0.4,
    y: 0.18,
    w: page.wIn - 0.8,
    h: 0.55,
    fontSize: 22,
    bold: true,
    color: '1F3864',
    align: 'center',
    fontFace: 'Microsoft YaHei',
    isTextBox: true,
  });
  slide.addText(opts.subtitle, {
    x: 0.4,
    y: 0.76,
    w: page.wIn - 0.8,
    h: 0.34,
    fontSize: 10.5,
    color: '595959',
    align: 'center',
    fontFace: 'Microsoft YaHei',
    isTextBox: true,
  });
  if (opts.mergedGroups > 0) {
    slide.addText(`已合并 ${opts.mergedGroups} 组持股比例低于 ${opts.mergeRatio}% 的股东，详见明细数据`, {
      x: 0.4,
      y: 1.08,
      w: page.wIn - 0.8,
      h: 0.24,
      fontSize: 9,
      color: 'BF8F00',
      align: 'center',
      fontFace: 'Microsoft YaHei',
      isTextBox: true,
    });
  }

  const toIn = (v: number) => v * opts.pxToIn;
  const toPt = (px: number) => Math.max(8, Math.min(40, px * opts.pxToIn * 72));
  // 比例标签单行显示：盒子窄时缩小字号而不是折行
  const fitRatioPt = (text: string, wIn: number): number => {
    const baseW = textWidth(text, 10);
    if (baseW <= 0) return toPt(11);
    const maxPt = wIn * 72;
    const f = Math.min(toPt(11), maxPt / (baseW * 0.075));
    return Math.max(6.5, f);
  };
  // 公司名称/注册地自适应字号：按文本框实际宽高动态缩放，保证文字不超出文本框
  const fitFont = (lines: string[], wIn: number, hIn: number, desiredPt: number, basePx: number): number => {
    if (lines.length === 0 || wIn <= 0 || hIn <= 0) return Math.max(desiredPt, 6.5);
    const wLimit = Math.min(
      ...lines.map((l) => {
        const bw = textWidth(l, basePx);
        return bw > 0 ? (wIn * 72) / (bw * basePx * 0.0075) : desiredPt;
      }),
    );
    const hLimit = (hIn * 72) / (lines.length * 1.35);
    return Math.max(6.5, Math.min(desiredPt, wLimit, hLimit));
  };

  // 水平居中（保留顶部起始位置，简单图表约占半张 A4 版面）
  const chartW = toIn(opts.layout.width);
  const chartH = toIn(opts.layout.height);
  const availW = page.wIn - AREA_LEFT_IN * 2;
  const offX = AREA_LEFT_IN + Math.max(0, (availW - chartW) / 2);
  const regionTop = AREA_TOP_IN;
  const regionBottom = page.hIn - 0.32; // 页脚上方
  const offY = regionTop + Math.max(0, (regionBottom - regionTop - chartH) / 2);
  const toX = (v: number) => offX + toIn(v);
  const toY = (v: number) => offY + toIn(v);

  // 连线：正交折线 + 汇聚总线 + 箭头。
  // OOXML 中 a:ext 的 cx/cy 必须 >= 0（ST_PositiveCoordinate），
  // 反向线段（x2<x1 或 y2<y1）必须归一化为最小角坐标 + 绝对值尺寸，
  // 否则 PowerPoint 会判定内容损坏并弹出修复提示。
  for (const s of opts.layout.segments) {
    const lineOpts: Record<string, unknown> = {
      x: toX(Math.min(s.x1, s.x2)),
      y: toY(Math.min(s.y1, s.y2)),
      w: toIn(Math.abs(s.x2 - s.x1)),
      h: toIn(Math.abs(s.y2 - s.y1)),
      line: {
        color: s.color ?? EDGE_COLOR,
        width: 1.3,
        endArrowType: s.arrow ? 'triangle' : 'none',
      },
    };
    slide.addShape(pptx.ShapeType.line as never, lineOpts);
  }

  // 公司节点：单个带边框的文本框（名称/注册地内嵌），拖动文本框时文字跟随
  for (const n of opts.layout.nodes) {
    const x = toX(n.x);
    const y = toY(n.y);
    const w = Math.max(toIn(n.w), 0.02);
    const h = Math.max(toIn(n.h), 0.02);
    const regPt = n.regPlace
      ? fitFont([`${REG_PREFIX}${n.regPlace}`], w, h, toPt(10), 10)
      : 0;
    const regHIn = n.regPlace ? (regPt * 1.35) / 72 : 0;
    const namePt = fitFont(n.lines, w, Math.max(h - regHIn, 0.1), toPt(13), 13);
    const runs: PptxGenJS.TextProps[] = [
      {
        text: n.lines.join('\n'),
        options: {
          fontSize: namePt,
          bold: n.isTarget,
          color: NODE_TEXT,
          fontFace: 'Microsoft YaHei',
          breakLine: Boolean(n.regPlace),
        },
      },
    ];
    if (n.regPlace) {
      runs.push({
        text: `${REG_PREFIX}${n.regPlace}`,
        options: {
          fontSize: regPt,
          color: NODE_TEXT,
          fontFace: 'Microsoft YaHei',
        },
      });
    }
    slide.addText(runs, {
      x,
      y,
      w,
      h,
      isTextBox: true,
      shape: 'roundRect',
      rectRadius: 0.06,
      line: {
        color: NODE_BORDER,
        width: n.isTarget ? 1.6 : 1.1,
        dashType: 'solid',
      },
      align: 'center',
      valign: 'middle',
      fontFace: 'Microsoft YaHei',
      margin: 0,
      wrap: true,
      lineSpacingMultiple: 1.0,
    });
  }

  // 持股比例：位于股权线两侧、线中间位置（左下/右下方位），不与线相交
  for (const l of opts.layout.labels ?? []) {
    const fontSize = fitRatioPt(l.text, toIn(l.w));
    slide.addText(l.text, {
      x: toX(l.x),
      y: toY(l.y),
      w: Math.max(toIn(l.w), 0.02),
      h: Math.max(toIn(l.h), 0.02),
      fontSize,
      bold: true,
      color: '000000',
      align: 'center',
      valign: 'middle',
      fontFace: 'Microsoft YaHei',
      isTextBox: true,
      margin: 0,
      wrap: false,
    });
  }

  // 境内 / 境外分隔虚线
  if (opts.layout.boundary) {
    const b = opts.layout.boundary;
    slide.addShape(pptx.ShapeType.line as never, {
      x: toX(Math.min(b.x1, b.x2)),
      y: toY(b.y),
      w: toIn(Math.abs(b.x2 - b.x1)),
      h: Math.max(toIn(0), 0.01),
      line: {
        color: BOUNDARY_COLOR,
        width: 1.1,
        dashType: 'dash',
      },
    });
    slide.addText('境外', {
      x: toX(b.x1),
      y: toY(b.y) - toIn(15),
      w: toIn(46),
      h: toIn(14),
      fontSize: toPt(9),
      color: '000000',
      align: 'left',
      valign: 'middle',
      fontFace: 'Microsoft YaHei',
      isTextBox: true,
    });
    slide.addText('境内', {
      x: toX(b.x1),
      y: toY(b.y) + toIn(2),
      w: toIn(46),
      h: toIn(14),
      fontSize: toPt(9),
      color: '000000',
      align: 'left',
      valign: 'middle',
      fontFace: 'Microsoft YaHei',
      isTextBox: true,
    });
  }

  // 页脚
  slide.addText(
    `本图由“股权穿透结构图生成器”基于工商公示数据自动生成，仅供授信尽调参考 · ${new Date().toLocaleDateString('zh-CN')}`,
    {
      x: 0.4,
      y: page.hIn - 0.32,
      w: page.wIn - 0.8,
      h: 0.24,
      fontSize: 8,
      color: 'A6A6A6',
      align: 'center',
      fontFace: 'Microsoft YaHei',
      isTextBox: true,
    },
  );

  return (await pptx.write({
    outputType: outputType as never,
  })) as PptBuffer;
}
