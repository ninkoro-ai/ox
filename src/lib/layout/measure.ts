// 文本测量与节点尺寸（按 96dpi CSS 像素估算）

export const FONT_SIZE = 13;
export const LINE_H = 17;
const PAD_X = 8;
const PAD_TOP = 6;
const PAD_BOTTOM = 6;
const REG_H = 13; // 注册地行的行高
const TAG_H = 13;
export const REG_PREFIX = '注册地：';
export const RATIO_FONT_SIZE = 10;
export const RATIO_LABEL_H = 16;
export const RATIO_LABEL_PAD = 6;
export const MAX_NODE_W = 200; // 公司文本框宽度上限：A4 上保证可读字号，超长名称自动换行

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

// 语义切分优先级：优先在“有限公司/有限合伙/股份有限公司”等词边界断行，避免把一个主体名称拆得支离破碎
const SEMANTIC_TOKENS = [
  '股份有限公司',
  '有限责任公司',
  '有限合伙企业',
  '集团有限公司',
  '控股有限公司',
  '投资有限公司',
  '实业有限公司',
  '（有限合伙）',
  '(有限合伙)',
  '有限合伙',
  '（普通合伙）',
  '有限公司',
];

/** 智能换行：优先按语义词边界断行，其次整词后移，最后才按字符断行 */
export function wrapTextSmart(text: string, maxWidth: number, fontSize: number = FONT_SIZE): string[] {
  if (!text) return [''];
  const n = text.length;
  const lines: string[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    let w = 0;
    let breakAfter = -1;
    while (j < n) {
      const cw = textWidth(text[j], fontSize);
      if (w + cw > maxWidth) break;
      w += cw;
      j++;
      for (const t of SEMANTIC_TOKENS) {
        const s = j - t.length;
        if (s >= i && text.startsWith(t, s)) breakAfter = j;
      }
    }
    if (j >= n) {
      lines.push(text.slice(i));
      break;
    }
    if (breakAfter > i) {
      lines.push(text.slice(i, breakAfter));
      i = breakAfter;
      continue;
    }
    // 若溢出点位于某个语义 token 内部，则把该 token 整体移到下一行
    let moveTo = -1;
    for (const t of SEMANTIC_TOKENS) {
      for (let p = Math.max(i, j - t.length + 1); p <= j && p + t.length <= n; p++) {
        if (text.startsWith(t, p) && p + t.length > j) {
          moveTo = p;
          break;
        }
      }
      if (moveTo >= 0) break;
    }
    if (moveTo > i) {
      lines.push(text.slice(i, moveTo));
      i = moveTo;
      continue;
    }
    if (j > i) {
      lines.push(text.slice(i, j));
      i = j;
    } else {
      lines.push(text[i]);
      i++;
    }
  }
  return lines.length ? lines : [''];
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
  minW = 130,
): NodeSize {
  const lines = wrapTextSmart(name, maxW - PAD_X * 2);
  const regLines = regPlace ? wrapTextSmart(`${REG_PREFIX}${regPlace}`, maxW - PAD_X * 2, 10) : [];
  const maxLineW = Math.max(
    0,
    ...lines.map((l) => textWidth(l)),
    ...regLines.map((l) => textWidth(l, 10)),
  );
  const w = Math.min(maxW, Math.max(minW, maxLineW + PAD_X * 2 + 8));
  const h =
    PAD_TOP +
    lines.length * LINE_H +
    regLines.length * REG_H +
    (tag ? TAG_H : 0);
  return { w, h: Math.max(h + PAD_BOTTOM, 50), lines };
}

/** 按指定宽度重算节点尺寸（同一层股东等宽分布，名称在框内自动换行） */
export function nodeSizeForWidth(
  name: string,
  regPlace: string | undefined,
  tag: string | undefined,
  width: number,
): NodeSize {
  const lines = wrapTextSmart(name, width - PAD_X * 2);
  const regLines = regPlace ? wrapTextSmart(`${REG_PREFIX}${regPlace}`, width - PAD_X * 2, 10) : [];
  const h =
    PAD_TOP +
    lines.length * LINE_H +
    regLines.length * REG_H +
    (tag ? TAG_H : 0) +
    PAD_BOTTOM;
  return { w: width, h: Math.max(h, 50), lines };
}

/** 持股比例标签的尺寸（独立文本框，置于连接线两侧） */
export function ratioLabelSize(text: string, fontSize: number = RATIO_FONT_SIZE): { w: number; h: number } {
  return {
    w: textWidth(text, fontSize) + Math.max(4, fontSize * 0.6),
    h: Math.max(RATIO_LABEL_H - 2, fontSize * 1.5),
  };
}
