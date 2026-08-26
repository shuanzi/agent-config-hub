/**
 * Frontend TypeScript types that mirror the Rust command payloads.
 * These are hand-maintained; keep them in sync with the Rust source.
 */

export type SyncMethod = 'auto' | 'symlink' | 'copy';
export type StorageLocation = 'hub' | 'unified';

/** 当前可选的一等 Agent；与后端 AgentType::as_str 一致。 */
export type AgentType = 'claude-code' | 'codex' | 'gemini-cli' | 'opencode';

export const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];

export interface AppSettings {
  syncMethod: SyncMethod;
  storageLocation: StorageLocation;
  claudeCodeConfigDir?: string;
  codexConfigDir?: string;
  geminiCliConfigDir?: string;
  opencodeConfigDir?: string;
}

export interface SetSettingRequest {
  key: string;
  value: string;
}

export interface StructuredError {
  code: string;
  context: Record<string, string>;
  suggestion?: string;
}

// ========== Project / configuration-context DTOs ==========

/** mirrors src-tauri/src/services/project.rs:ProjectSummary */
export interface ProjectSummary {
  /** 数据库生成的稳定不透明标识；展示名和路径都不是身份。 */
  projectId: string;
  displayName: string;
  rootPath: string;
}

/** 只用于读取的配置上下文；`all` 不能作为 mutation target。 */
export type ConfigContext =
  { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string };

/** 三类资产 mutation 使用的完整 ownership target。 */
export type ScopeTarget = { scope: 'global' } | { scope: 'project'; projectId: string };

// ========== Skill DTOs ==========

/** mirrors src-tauri/src/services/skill.rs:SkillApps */
export interface SkillApps {
  claudeCode: boolean;
  codex: boolean;
  geminiCli: boolean;
  opencode: boolean;
}

/** mirrors src-tauri/src/services/skill.rs:InstalledSkill */
export interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SkillApps;
  installedAt: number;
  contentHash?: string;
  updatedAt: number;
  /** 记录的完整 ownership target；所有既有资产 mutation 必须从此处派生。 */
  target: ScopeTarget;
}

/** mirrors src-tauri/src/services/skill.rs:DiscoverableSkill */
export interface DiscoverableSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  /** 当前明确 discovery target 下的安装状态。 */
  installed: boolean;
}

/** mirrors src-tauri/src/services/skill.rs:SkillRepo */
export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

/** mirrors src-tauri/src/services/skill.rs:UnmanagedSkill */
export interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  foundIn: string[];
  path: string;
}

/** mirrors src-tauri/src/services/skill.rs:SkillUninstallResult */
export interface SkillUninstallResult {
  backupPath?: string;
}

/** mirrors src-tauri/src/services/skill.rs:SkillUpdateInfo */
export interface SkillUpdateInfo {
  id: string;
  name: string;
  currentHash?: string;
  remoteHash: string;
}

/** mirrors src-tauri/src/services/skill.rs:MigrationResult */
export interface MigrationResult {
  migratedCount: number;
  skippedCount: number;
  errors: string[];
}

/** mirrors src-tauri/src/commands/settings.rs:MigrationSummary */
export interface MigrationSummary {
  skill: MigrationResult;
  subagent: MigrationResult;
  projectionErrors: string[];
}

/** mirrors src-tauri/src/services/skill.rs:SkillBackupEntry */
export interface SkillBackupEntry {
  backupId: string;
  backupPath: string;
  createdAt: number;
  skill: InstalledSkill;
}

/** mirrors src-tauri/src/services/skill.rs:ImportSkillSelection */
export interface ImportSkillSelection {
  directory: string;
  apps: SkillApps;
  sourcePath?: string;
}

// ========== Long-term instruction DTOs ==========

/** 长期指令仅支持两个固定文档产物；Gemini CLI 不在此能力范围内。 */
export type InstructionDocumentKind = 'claude' | 'agents';

export type InstructionAgent = 'claude-code' | 'codex' | 'opencode';

/** mirrors src-tauri/src/services/instruction.rs:InstructionDocument */
export interface InstructionDocument {
  kind: InstructionDocumentKind;
  fileName: 'CLAUDE.md' | 'AGENTS.md';
  appliesTo: InstructionAgent[];
  target: ScopeTarget;
  content: string;
  exists: boolean;
  updatedAt?: number;
}

// ========== Subagent DTOs ==========

/** mirrors src-tauri/src/services/subagent.rs:SubagentApps */
export interface SubagentApps {
  claudeCode: boolean;
  codex: boolean;
  geminiCli: boolean;
  opencode: boolean;
}

/** mirrors src-tauri/src/services/subagent.rs:InstalledSubagent */
export interface InstalledSubagent {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SubagentApps;
  installedAt: number;
  contentHash?: string;
  updatedAt: number;
  /** 记录的完整 ownership target；所有既有资产 mutation 必须从此处派生。 */
  target: ScopeTarget;
}

/** mirrors src-tauri/src/services/subagent.rs:DiscoverableSubagent */
export interface DiscoverableSubagent {
  key: string;
  name: string;
  description: string;
  directory: string;
  path: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  /** 当前明确 discovery target 下的安装状态。 */
  installed: boolean;
}

/** mirrors src-tauri/src/services/subagent.rs:SubagentRepo */
export interface SubagentRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

/** mirrors src-tauri/src/services/subagent.rs:SubagentUninstallResult */
export interface SubagentUninstallResult {
  backupPath?: string;
}

/** mirrors src-tauri/src/services/subagent.rs:SubagentUpdateInfo */
export interface SubagentUpdateInfo {
  id: string;
  name: string;
  currentHash?: string;
  remoteHash: string;
}

/** mirrors src-tauri/src/services/subagent.rs:SubagentBackupEntry */
export interface SubagentBackupEntry {
  backupId: string;
  backupPath: string;
  createdAt: number;
  subagent: InstalledSubagent;
}
