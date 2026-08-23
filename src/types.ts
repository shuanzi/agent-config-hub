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
}

// ========== Prompt DTOs ==========

/** mirrors src-tauri/src/services/prompt.rs:Prompt */
export interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string;
  enabled: boolean;
  createdAt?: number;
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
