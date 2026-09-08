import { invoke } from './invoke';
import type { AgentType, ConfigContext, ScopeTarget } from '../../types';

/** 原生定义契约，对应 Rust native_subagent service；identity 不由前端路径拼接。 */
export interface NativeSubagentDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface NativeSubagentDefinition {
  identity: string;
  name: string;
  description?: string;
  agent: AgentType;
  target: ScopeTarget;
  format: 'markdown' | 'toml' | 'json' | 'jsonc-entry' | 'legacy-markdown';
  sourceKind: 'file' | 'config-entry' | 'legacy';
  sourcePath: string;
  sourceKey?: string;
  managementStatus: 'unmanaged' | 'managed' | 'disabled' | 'invalid' | 'legacy-review';
  enabled: boolean;
  contentHash?: string;
  isSymlink: boolean;
  symlinkTarget?: string;
  diagnostics: NativeSubagentDiagnostic[];
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  repoPath?: string;
}

export interface NativeSubagentScanResult {
  definitions: NativeSubagentDefinition[];
  scanErrors: NativeSubagentDiagnostic[];
}

export interface NativeSubagentContent {
  definition: NativeSubagentDefinition;
  content: string;
  contentHash: string;
}

export const scanNativeSubagents = (context: ConfigContext) =>
  invoke<NativeSubagentScanResult>('scan_native_subagents', { context });
export const readNativeSubagent = (identity: string) =>
  invoke<NativeSubagentContent>('read_native_subagent', { identity });
export const adoptNativeSubagent = (
  identity: string,
  expectedHash: string,
  confirmSymlink: boolean,
) =>
  invoke<NativeSubagentDefinition>('adopt_native_subagent', {
    identity,
    expectedHash,
    confirmSymlink,
  });
export const saveNativeSubagent = (identity: string, content: string, expectedHash: string) =>
  invoke<NativeSubagentContent>('save_native_subagent', { identity, content, expectedHash });
export const setNativeSubagentEnabled = (
  identity: string,
  enabled: boolean,
  expectedHash: string,
) =>
  invoke<NativeSubagentDefinition>('set_native_subagent_enabled', {
    identity,
    enabled,
    expectedHash,
  });
export const uninstallNativeSubagent = (identity: string, expectedHash: string) =>
  invoke<{ backupId?: string; definition?: NativeSubagentDefinition }>(
    'uninstall_native_subagent',
    {
      identity,
      expectedHash,
    },
  );

export interface NativeSubagentBackup {
  backupId: string;
  identity: string;
  name: string;
  agent: AgentType;
  target: ScopeTarget;
  sourcePath: string;
  createdAt: number;
  reason?: string;
  format?: NativeSubagentDefinition['format'];
  contentHash?: string;
  legacy?: boolean;
}
export interface NativeSubagentUpdatePreview {
  identity: string;
  currentContent: string;
  nextContent: string;
  currentHash: string;
  remoteHash: string;
  locallyModified: boolean;
}
export const getNativeSubagentBackups = (context: ConfigContext) =>
  invoke<NativeSubagentBackup[]>('get_native_subagent_backups', { context });
export const deleteNativeSubagentBackup = (backupId: string, expectedContentHash: string) =>
  invoke<void>('delete_native_subagent_backup', { backupId, expectedContentHash });
export const backupNativeSubagent = (identity: string, expectedHash: string) =>
  invoke<NativeSubagentBackup>('backup_native_subagent', { identity, expectedHash });
export const restoreNativeSubagentBackup = (backupId: string, expectedDestinationHash?: string) =>
  invoke<NativeSubagentDefinition>('restore_native_subagent_backup', {
    backupId,
    expectedDestinationHash,
  });
export const previewNativeSubagentUpdate = (identity: string) =>
  invoke<NativeSubagentUpdatePreview>('preview_native_subagent_update', { identity });
export const applyNativeSubagentUpdate = (
  identity: string,
  expectedHash: string,
  expectedRemoteHash: string,
) =>
  invoke<NativeSubagentDefinition>('apply_native_subagent_update', {
    identity,
    expectedHash,
    expectedRemoteHash,
  });

export interface NativeSubagentDiscovery {
  key: string;
  name: string;
  description: string;
  path: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  format: string;
  compatibleAgents: AgentType[];
}
export const discoverNativeSubagents = (target: ScopeTarget) =>
  invoke<NativeSubagentDiscovery[]>('discover_native_subagents', { target });
export const installNativeSubagent = (
  subagent: NativeSubagentDiscovery,
  target: ScopeTarget,
  agent: AgentType,
) => invoke<NativeSubagentDefinition>('install_native_subagent', { subagent, target, agent });
