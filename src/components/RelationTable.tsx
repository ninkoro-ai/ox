import type { EquityRelation, EquityTree, StopReason } from '../lib/types';

function statusText(reason: StopReason, threshold: number): string {
  switch (reason) {
    case 'expanded':
      return '穿透';
    case 'below-threshold':
      return `未穿透(<${threshold}%)`;
    case 'natural-person':
      return '自然人（停止）';
    case 'overseas':
      return '境外（停止）';
    case 'unknown-ratio':
      return '股比不详（停止）';
    case 'no-shareholders':
      return '无股东信息';
    case 'max-level':
      return '已达层级上限';
    case 'merged':
      return '已合并';
  }
}

interface Props {
  relations: EquityRelation[];
  tree: EquityTree | null;
  threshold: number;
  mergedGroups: number;
  mergeRatio: number;
}

export default function RelationTable({ relations, tree, threshold, mergedGroups, mergeRatio }: Props) {
  const statusMap = new Map<string, string>();
  if (tree) {
    for (const n of tree.nodes) {
      if (n.isTarget) continue;
      const key = `${n.name}|${n.level}`;
      if (!statusMap.has(key)) statusMap.set(key, statusText(n.stopReason, threshold));
    }
  }

  return (
    <div className="card">
      <h3>解析出的股权关系（{relations.length} 条）</h3>
      <div className="table-wrap">
        <table className="relation-table">
          <thead>
            <tr>
              <th>#</th>
              <th>股东名称</th>
              <th>持股比例</th>
              <th>被投资企业</th>
              <th>层级</th>
              <th>穿透状态</th>
            </tr>
          </thead>
          <tbody>
            {relations.map((r, i) => {
              const key = `${r.investor}|${r.level}`;
              return (
                <tr key={`${r.investor}-${r.investee}-${i}`}>
                  <td>{i + 1}</td>
                  <td>{r.investor}</td>
                  <td>{r.ratio === null ? '不详' : `${r.ratio}%`}</td>
                  <td>{r.investee}</td>
                  <td>{r.level ?? '—'}</td>
                  <td>{statusMap.get(key) ?? (tree ? '—' : '待穿透')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mergedGroups > 0 && (
        <p className="muted-note">
          注：因内容较多，已合并 {mergedGroups} 组持股比例低于 {mergeRatio}% 的股东为“其他股东”，合并明细见上表。
        </p>
      )}
    </div>
  );
}
