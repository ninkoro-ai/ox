// 文本测量与节点尺寸（按 96dpi CSS 像素估算）

export const FONT_SIZE = 13;
export const LINE_H = 17;
const PAD_X = 10;
const PAD_TOP = 7;
const PAD_BOTTOM = 7;
const REG_H = 13; // 注册地行的行高
const TAG_H = 13;
export const REG_PREFIX = '注册地：';
export const RATIO_FONT_SIZE = 10;
export const RATIO_LABEL_H = 16;
export const RATIO_LABEL_PAD = 6;
export const MAX_NODE_W = 280; // 公司文本框宽度上限，尽量让名称显示在一行

export function textWidth(text: string, fontSize: number = FONT_SIZE): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += c > 0x2e80 || c === 0x3000 ? fontSize : fontSize * 0.58;
  }
  return w;
}

export function wrapText(text: string, maxWidth: number, fontSize: number = FONT_SIZE): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  for (const ch of text) {
    const cw = textWidth(ch, fontSize);
    if (curW + cw > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      curW = cw;
    } else {
      cur += ch;
      curW += cw;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface NodeSize {
  w: number;
  h: number;
  lines: string[];
}

export function nodeSize(
  name: string,
  regPlace: string | undefined,
  tag: string | undefined,
  maxW = MAX_NODE_W,
  minW = 150,
): NodeSize {
  const lines = wrapText(name, maxW - PAD_X * 2);
  const regLines = regPlace ? wrapText(`${REG_PREFIX}${regPlace}`, maxW - PAD_X * 2, 10) : [];
  const maxLineW = Math.max(
    0,
    ...lines.map((l) => textWidth(l)),
    ...regLines.map((l) => textWidth(l, 10)),
  );
  const w = Math.min(maxW, Math.max(minW, maxLineW + PAD_X * 2 + 12));
  const h =
    PAD_TOP +
    lines.length * LINE_H +
    regLines.length * REG_H +
    (tag ? TAG_H : 0);
  return { w, h: Math.max(h + PAD_BOTTOM, 52), lines };
}

/** 按指定宽度重算节点尺寸（同一层股东等宽分布，名称在框内自动换行） */
export function nodeSizeForWidth(
  name: string,
  regPlace: string | undefined,
  tag: string | undefined,
  width: number,
): NodeSize {
  const lines = wrapText(name, width - PAD_X * 2);
  const regLines = regPlace ? wrapText(`${REG_PREFIX}${regPlace}`, width - PAD_X * 2, 10) : [];
  const h =
    PAD_TOP +
    lines.length * LINE_H +
    regLines.length * REG_H +
    (tag ? TAG_H : 0) +
    PAD_BOTTOM;
  return { w: width, h: Math.max(h, 52), lines };
}

/** 持股比例标签的尺寸（独立文本框，置于连接线两侧） */
export function ratioLabelSize(text: string): { w: number; h: number } {
  return {
    w: textWidth(text, RATIO_FONT_SIZE) + RATIO_LABEL_PAD * 2,
    h: RATIO_LABEL_H,
  };
}
