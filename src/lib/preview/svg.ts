import type { LayoutResult } from '../types';
import { BOUNDARY_COLOR, EDGE_COLOR, NODE_BORDER, NODE_TEXT, TAG_TEXT } from '../theme';
import { REG_PREFIX } from '../layout/measure';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderChartSvg(layout: LayoutResult, threshold: number): string {
  const W = layout.width;
  const H = layout.height;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Microsoft YaHei','PingFang SC',sans-serif">`,
  );
  parts.push(
    `<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${EDGE_COLOR}"/></marker></defs>`,
  );

  for (const s of layout.segments) {
    const isH = s.y1 === s.y2;
    const marker = s.arrow ? ' marker-end="url(#arr)"' : '';
    const color = s.color ?? EDGE_COLOR;
    parts.push(
      `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#${color}" stroke-width="1.6"${marker}${isH ? '' : ''}/>`,
    );
  }

  for (const n of layout.nodes) {
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="none" stroke="#${NODE_BORDER}" stroke-width="${n.isTarget || n.control ? '2.2' : '1.2'}"/>`,
    );
    const cx = n.x + n.w / 2;
    // 名称 + 注册地 + 标签整体在文本框内上下居中
    const namePx = n.lines.length * 17;
    const regPx = n.regPlace ? 13 : 0;
    const tagPx = n.tag ? 13 : 0;
    const contentPx = namePx + regPx + tagPx;
    let ty = n.y + Math.max(0, (n.h - contentPx) / 2) + 13;
    for (let i = 0; i < n.lines.length; i++) {
      const y = ty + i * 17;
      parts.push(
        `<text x="${cx}" y="${y}" text-anchor="middle" font-size="13" fill="#${NODE_TEXT}" font-weight="${n.isTarget || n.control ? '700' : '400'}">${esc(n.lines[i])}</text>`,
      );
    }
    ty += namePx;
    if (n.regPlace) {
      parts.push(
        `<text x="${cx}" y="${ty + 10}" text-anchor="middle" font-size="10" fill="#000000">${esc(REG_PREFIX + n.regPlace)}</text>`,
      );
      ty += regPx;
    }
    if (n.tag) {
      parts.push(
        `<text x="${cx}" y="${ty + 11}" text-anchor="middle" font-size="10" fill="#${TAG_TEXT}">${esc(n.tag)}</text>`,
      );
      ty += tagPx;
    }
  }

  // 持股比例：位于股权线两侧、线中间位置（左下/右下方位），不与线相交
  for (const l of layout.labels ?? []) {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    parts.push(
      `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" fill="#000000" font-weight="600">${esc(l.text)}</text>`,
    );
  }

  // 境内 / 境外分隔虚线
  if (layout.boundary) {
    const b = layout.boundary;
    parts.push(
      `<line x1="${b.x1}" y1="${b.y}" x2="${b.x2}" y2="${b.y}" stroke="#${BOUNDARY_COLOR}" stroke-width="1.1" stroke-dasharray="7,4"/>`,
    );
    parts.push(
      `<text x="${b.x1 + 3}" y="${b.y - 5}" font-size="10" fill="#000000">境外</text>`,
    );
    parts.push(
      `<text x="${b.x1 + 3}" y="${b.y + 14}" font-size="10" fill="#000000">境内</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}
