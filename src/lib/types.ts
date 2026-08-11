// ── 基础数据模型 ─────────────────────────────────────────────

/** 一条标准股权关系：investor 持有 investee 的 ratio（百分比数值） */
export interface EquityRelation {
  investor: string;
  investee: string;
  ratio: number | null; // 如 80.48；null 表示“不详/未披露”
  level?: number; // 股东层级，1 = 目标企业直接股东
  sourceSheet?: string;
  investorType?: string;
  investeeType?: string;
}

export type SheetFormat = 'structured-levels' | 'generic-table';

export interface ParsedResult {
  targetName: string | null;
  relations: EquityRelation[];
  sheets: string[];
  format: SheetFormat;
  warnings: string[];
  entityTypes: Record<string, string>; // 企业名称 -> 企业类型
  columnMap?: {
    investor: string;
    investee: string;
    ratio: string;
    level: string;
  };
}

/** 穿透停止原因 */
export type StopReason =
  | 'expanded'
  | 'natural-person'
  | 'overseas'
  | 'below-threshold'
  | 'unknown-ratio'
  | 'no-shareholders'
  | 'max-level'
  | 'merged';

export interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  level: number; // 距目标企业的层级，目标=0
  ratio: number | null; // 在父节点中的持股比例；目标企业为 null
  ratioText: string;
  stopReason: StopReason;
  tag?: string; // 用于图上标注的小标签，如“自然人”“境外”
  regPlace?: string; // 注册地，如“中国”“香港”；合并节点/自然人不显示
  children: string[];
  isTarget: boolean;
  isMerged: boolean;
  mergedCount: number;
  mergedSum: number | null;
}

export interface TreeEdge {
  fromId: string; // 投资人节点
  toId: string; // 被投资企业节点
  ratio: number | null;
  label: string;
}

export interface EquityTree {
  targetName: string;
  nodes: TreeNode[];
  edges: TreeEdge[];
  stats: {
    totalRelations: number;
    shownNodes: number;
    expandedNodes: number;
    stoppedByPerson: number;
    stoppedByOverseas: number;
    stoppedByThreshold: number;
    stoppedByUnknown: number;
    maxLevel: number;
  };
  warnings: string[];
}

export interface PenetrateOptions {
  threshold: number; // 穿透阈值，默认 25
  stopAtNaturalPerson: boolean;
  stopAtOverseas: boolean;
  showBelowThreshold: boolean;
  maxLevel: number;
  ratioPrecision?: number; // 持股比例小数位，默认 2
}

// ── 布局模型 ─────────────────────────────────────────────

export interface LayoutNode {
  id: string;
  name: string;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  ratioText: string;
  stopReason: StopReason;
  tag?: string;
  regPlace?: string;
  isTarget: boolean;
  isMerged: boolean;
}

export interface LayoutSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrow: boolean;
  edgeId: string;
  kind: 'drop' | 'bus' | 'entry';
  /** 连线颜色（RRGGBB，不含 #）。默认黑色；与其他连线交叉/重叠时为防混淆改用调色板颜色 */
  color?: string;
}

export type RatioLabelSide = 'left' | 'right';

/** 持股比例标签：独立于公司文本框，位于连接线两侧 */
export interface RatioLabel {
  edgeId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: RatioLabelSide;
  anchorX: number; // 所属连接线的 x
  anchorY: number; // 所属连接线（标签对齐处）的 y
}

/** 境内 / 境外分隔虚线 */
export interface LayoutBoundary {
  y: number;
  x1: number;
  x2: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  label: string;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  segments: LayoutSegment[];
  edges: LayoutEdge[];
  labels: RatioLabel[];
  boundary: LayoutBoundary | null;
  width: number;
  height: number;
}

export type PageKey = '16x9' | 'a4' | 'a3';
export type PageMode = 'auto' | PageKey;
