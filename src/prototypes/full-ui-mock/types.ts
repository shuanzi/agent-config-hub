/**
 * THROWAWAY UI MOCK — never import production gateway/session/Tauri modules here.
 * These types deliberately model only visual prototype state.
 */
export const variants = ['A', 'B', 'C', 'selected'] as const;
export type MockVariant = (typeof variants)[number];

export const journeys = ['browse', 'edit', 'create', 'convert', 'manage', 'recover'] as const;
export type MockJourney = (typeof journeys)[number];

export const scenarios = [
  'ready',
  'stale',
  'readonly',
  'dirty',
  'conflict',
  'degraded',
  'blocked',
  'failed',
] as const;
export type MockScenario = (typeof scenarios)[number];

export const assetTypes = ['Skills', '长期指令', 'Subagents', 'Hooks'] as const;
export type AssetType = (typeof assetTypes)[number];

/** selected B2 候选层的导航收敛；shared AssetType 仍保留 Hooks 供 legacy 方案使用。 */
export const selectedAssetTypes = ['Skills', '长期指令', 'Subagents'] as const;
export type SelectedAssetType = (typeof selectedAssetTypes)[number];

/** 项目上下文中“项目自有 + 全局适用”的 throwaway 布局候选。 */
export const inheritanceLayouts = ['A', 'B', 'C'] as const;
export type InheritanceLayout = (typeof inheritanceLayouts)[number];

export type Stage =
  | 'browse'
  | 'editing'
  | 'discard'
  | 'review'
  | 'confirm'
  | 'result'
  | 'conflict'
  | 'target'
  | 'mapping'
  | 'manage'
  | 'recover';

export type ViewPreset = 'wide' | 'medium' | 'narrow';
export type InspectorSection = 'source' | 'compatibility' | 'recovery';
export type SearchRange = 'current' | 'all';
export type CatalogState = 'normal' | 'loading' | 'empty';
export type PanelOverlay = 'library' | 'files' | 'inspector' | null;
export type SkillAgentTargetStatus = 'recognized' | 'installable' | 'convertible' | 'blocked';
export type SkillTargetAction = 'install' | 'convert';
export type CreateMode = '新建' | '从本地导入' | '导入项目 Skill';
/** 'all' 是类型优先导航的默认聚合作用域；写入路径仍只由资产自身上下文决定。 */
export type ConfigContext = 'all' | 'global' | `project:${string}`;

/** Skills 列表中每个 Agent 的识别或可准备操作状态；仅用于原型展示。 */
export interface SkillAgentTarget {
  agent: string;
  status: SkillAgentTargetStatus;
  /** 仅 selected Mock 的会话内启用预览；刷新后重置，绝不代表真实配置。 */
  enabled?: boolean;
  reason?: string;
}

export interface MockAsset {
  id: string;
  type: AssetType;
  name: string;
  agent: string;
  scope: '全局' | '项目';
  project: string;
  status?: '只读' | '漂移' | '冲突' | '不兼容';
  description: string;
  /** 仅 Skills 使用；它不代表跨 Agent 的新资产身份。 */
  agentTargets?: SkillAgentTarget[];
  files: Array<{ name: string; language: string; content: string; changed?: boolean }>;
}

export interface RecoveryPoint {
  id: string;
  time: string;
  assetId: string;
  assetName: string;
  pinned: boolean;
}

export interface MockUiState {
  variant: MockVariant;
  /** 只影响 selected + 项目 browse list 的 throwaway 信息布局。 */
  inheritanceLayout: InheritanceLayout;
  journey: MockJourney;
  scenario: MockScenario;
  stage: Stage;
  assetType: AssetType;
  assetId: string;
  fileName: string;
  view: 'source' | 'structured';
  search: string;
  searchRange: SearchRange;
  /** selected 原型专属：右上角全局搜索，独立于旧方案的类目内搜索。 */
  globalSearch: string;
  globalSearchOpen: boolean;
  agentFilter: string;
  catalogState: CatalogState;
  panelOverlay: PanelOverlay;
  scopeFilter: '全部' | '全局' | '项目';
  /** 筛选弹层中的多选条件（范围条件复用 scopeFilter，避免双数据源） */
  filters: { status: string[]; agent: string[] };
  filterOpen: boolean;
  dirty: boolean;
  /** 以原生相对文件名隔离的本地草稿；不会形成多资产草稿池。 */
  drafts: Record<string, string>;
  focused: boolean;
  inspectorOpen: InspectorSection | null;
  viewport: ViewPreset;
  libraryWidth: number;
  inspectorWidth: number;
  managementTab: 'projects' | 'agents' | 'recovery';
  createMode: CreateMode;
  createName: string;
  /** selected 原型的项目内 Skill 导入来源；仅用于内存交互。 */
  importProject: string;
  targetAssetType: AssetType;
  targetAgent: string;
  targetScope: '全局' | '项目';
  recoveryAction: 'idle' | 'delete-confirm' | 'delete-result';
  /** selected Skills 行发起的单目标准备动作；不触发即时写入。 */
  skillTarget: { action: SkillTargetAction; agent: string } | null;
  /** 窄窗口中在“列表 / 结构化详情”两个表面间切换。 */
  selectedPanel: 'list' | 'detail';
  /** 窄窗口单表面栈顺序为 类型(type) → 作用域(context) → 列表(list) → 详情(detail)。 */
  selectedStep: 'context' | 'type' | 'list' | 'detail';
  /** selected 原型专属：配置上下文是全部、全局或一个原生项目；项目名由 mockAssets 派生。 */
  configContext: ConfigContext;
  /** 最近一次 prepare / apply 计算出的实际变更文件数；结果页不会回退到资产总文件数。 */
  appliedFileCount: number | null;
  notice: string | null;
}
