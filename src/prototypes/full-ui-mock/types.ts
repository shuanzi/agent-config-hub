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

export interface MockAsset {
  id: string;
  type: AssetType;
  name: string;
  agent: string;
  scope: '全局' | '项目';
  project: string;
  status?: '只读' | '漂移' | '冲突' | '不兼容';
  description: string;
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
  journey: MockJourney;
  scenario: MockScenario;
  stage: Stage;
  assetType: AssetType;
  assetId: string;
  fileName: string;
  view: 'source' | 'structured';
  search: string;
  searchRange: SearchRange;
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
  createMode: '新建' | '从本地导入';
  createName: string;
  targetAssetType: AssetType;
  targetAgent: string;
  targetScope: '全局' | '项目';
  recoveryAction: 'idle' | 'delete-confirm' | 'delete-result';
  notice: string | null;
}
