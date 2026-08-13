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
  remark?: string; // 人工录入模板的备注列
}

export type SheetFormat = 'structured-levels' | 'generic-table' | 'manual-template';

/** 主体信息（人工录入模板预留：未来集团授信图使用） */
export interface EntityProfile {
  name: string;
  industry?: string;
  sector?: string;
  isCreditSubject?: boolean;
}

export interface ParsedResult {
  targetName: string | null;
  relations: EquityRelation[];
  sheets: string[];
  format: SheetFormat;
  warnings: string[];
  entityTypes: Record<string, string>; // 企业名称 -> 企业类型
  entityProfiles?: EntityProfile[]; // 人工录入模板“主体信息”页
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
  /** 是否处于控制链上（第一层 ≥ 阈值股东及其上游链条；银行标准模式用于突出显示） */
  control?: boolean;
}

export interface TreeEdge {
  fromId: string; // 投资人节点
  toId: string; // 被投资企业节点
  ratio: number | null;
  label: string;
}

// ── 图模型（股权计算引擎底层数据模型）──────────────────────────
// 底层统一使用 Node + Edge 的 EquityGraph，支撑交叉持股、多路径持股、
// 最终受益人与综合持股比例计算；展示层（EquityTree）仅是它的投影。

export interface GraphNode {
  id: string;
  name: string;
  /** 实体类型（自然人/企业/境外等），来自投资方类型/企业类型 */
  entityType?: string;
}

export interface GraphEdge {
  fromId: string; // 投资方节点
  toId: string; // 被投资方节点
  ratio: number | null;
  remark?: string;
  source?: string;
}

export interface EquityGraph {
  targetName: string; // 目标企业（授信主体）
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  control?: boolean;
  /** 同一父节点下的行号（同层节点超过 5 个时自动换行排列，0 起） */
  row?: number;
}

export interface LayoutSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrow: boolean;
  edgeId: string;
  /** 该线段所属的股权关系终点（被投资方节点 id），用于把路径归属到 Edge */
  toId: string;
  kind: 'drop' | 'bus' | 'entry';
  /** 连线颜色（RRGGBB，不含 #）。默认黑色；与其他连线交叉/重叠时为防混淆改用调色板颜色 */
  color?: string;
  /** 是否属于控制链连线（银行标准模式加粗突出） */
  control?: boolean;
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

/** 比例标签位置：由布局阶段计算并写入 EquityEdge.labelPosition */
export interface RatioLabelPosition {
  side: RatioLabelSide;
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number; // 所属连接线的 x
  anchorY: number; // 所属连接线（标签对齐处）的 y
}

/**
 * 股权关系边：持股比例提升为 Edge 属性，布局阶段负责计算连线路径（segments）
 * 与标签位置（labelPosition），PPT 生成阶段据此绘制连线和比例。
 */
export interface EquityEdge {
  fromId: string;
  toId: string;
  ratio: number | null;
  label: string;
  labelPosition?: RatioLabelPosition;
  /**
   * 连接路径：由布局阶段计算并归属于本 Edge 的全部线段（正交折线/总线/箭头）。
   * 渲染器只遍历 Edge 及其 path 绘制连线；未来接入 PowerPoint Connector 时仅替换渲染层。
   */
  path?: LayoutSegment[];
}

/** 境内 / 境外分隔虚线 */
export interface LayoutBoundary {
  y: number;
  x1: number;
  x2: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  segments: LayoutSegment[];
  edges: EquityEdge[];
  /** 兼容投影：由 edges 的 labelPosition 生成，供预览与旧逻辑使用 */
  labels: RatioLabel[];
  boundary: LayoutBoundary | null;
  width: number;
  height: number;
}

export type PageKey = 'a4' | 'a3';
export type PageMode = 'auto' | PageKey;

/** 布局模式 */
export type LayoutMode = 'auto' | 'bank-standard' | 'minor-shareholders' | 'bank-ownership';

/**
 * 统一生成配置：贯穿解析、穿透、布局与 PPT 生成全流程
 */
export interface GenerateConfig {
  /** 穿透阈值（%）：仅第一层持股 ≥ 阈值的股东触发穿透，默认 25 */
  penetrationThreshold: number;
  /** 低比例股东合并阈值（%）：默认 5 */
  minorShareholderThreshold: number;
  /** 页面尺寸：auto（A4 → A3 自动适配）| a4 | a3 */
  pageSize: PageMode;
  /** 最小字号（pt）：PPT 中文本框字号下限，默认 9，禁止通过无限缩小字体解决布局问题 */
  fontMinSize: number;
  /** 布局模式：bank-standard 突出控制链；minor-shareholders 低比例股东合并显示 */
  layoutMode: LayoutMode;
  /** 每层最多展示的股东数量（默认 10）：超出部分自动归集为“其他持股不超X%”股东 */
  maxShareholdersPerLevel: number;
  /** 是否启用每层股东数量上限归集（默认 true） */
  capShareholders: boolean;
}

export const DEFAULT_GENERATE_CONFIG: GenerateConfig = {
  penetrationThreshold: 25,
  minorShareholderThreshold: 5,
  pageSize: 'auto',
  fontMinSize: 9,
  layoutMode: 'bank-ownership',
  maxShareholdersPerLevel: 10,
  capShareholders: true,
};
