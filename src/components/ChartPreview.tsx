import type { EquityTree, LayoutResult, PageKey } from '../lib/types';
import { PAGES } from '../lib/layout/page';
import type { CollisionReport } from '../lib/layout/collision';

interface Props {
  title: string;
  svg: string;
  tree: EquityTree;
  layout: LayoutResult;
  page: PageKey;
  check: CollisionReport | null;
  mergedGroups: number;
  onDownload: () => void;
  onFix?: () => void;
  fixNotice?: string;
  generating: boolean;
}

export default function ChartPreview({
  title,
  svg,
  tree,
  layout,
  page,
  check,
  mergedGroups,
  onDownload,
  onFix,
  fixNotice,
  generating,
}: Props) {
  const level1 = tree.nodes.filter((n) => n.level === 1).length;
  const ok =
    check &&
    check.nodeOverlaps === 0 &&
    check.segmentNodeHits === 0 &&
    check.labelNodeHits === 0 &&
    check.labelOverlaps === 0 &&
    check.labelSegmentHits === 0;
  return (
    <div className="card">
      <div className="preview-head">
        <div>
          <h3>股权穿透结构图</h3>
          <p className="preview-title">{title}</p>
        </div>
        <button className="btn primary" onClick={onDownload} disabled={generating}>
          {generating ? '生成中…' : '下载可编辑 PPT (.pptx)'}
        </button>
      </div>
      <div className="stats-row">
        <span>节点 {tree.nodes.length}</span>
        <span>一级股东 {level1}</span>
        <span>自然人停止 {tree.stats.stoppedByPerson}</span>
        <span>境外停止 {tree.stats.stoppedByOverseas}</span>
        <span>未穿透 {tree.stats.stoppedByThreshold}</span>
        <span>页面 {PAGES[page].name}</span>
        <span className={ok ? 'ok' : 'warn'}>{ok ? '布局检测：无重叠' : '布局检测：存在重叠，请调整设置'}</span>
      </div>
      {mergedGroups > 0 && <p className="banner">已合并 {mergedGroups} 组低比例股东以适配版面</p>}
      {!ok && onFix && (
        <div className="fix-row">
          <span className="warn">布局存在重叠，可一键调整为最优设置（自动合并低比例股东 + 适配页面）</span>
          <button type="button" className="btn primary" onClick={onFix}>
            一键修复布局
          </button>
        </div>
      )}
      {fixNotice && <p className="banner">{fixNotice}</p>}
      <div className="chart-box">
        <div className="chart-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <p className="muted-note">
        画布 {Math.round(layout.width)} × {Math.round(layout.height)} px · 线条为可编辑正交连接线，箭头指向被投资企业
      </p>
    </div>
  );
}
