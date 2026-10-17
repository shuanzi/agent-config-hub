import { invoke } from './invoke';
import type {
  ConfigContext,
  DiscoverableSkill,
  ImportSkillSelection,
  InstalledSkill,
  ScopeTarget,
  SkillImportPreview,
  SkillLocation,
  SkillPlacementAsset,
  SkillPlacementTarget,
  SkillBackupEntry,
  SkillRepo,
  SkillUninstallResult,
  SkillUpdateInfo,
  UnmanagedSkill,
} from '../../types';

export async function getInstalledSkills(context: ConfigContext): Promise<InstalledSkill[]> {
  return invoke('get_installed_skills', { context });
}

export async function discoverAvailableSkills(target: ScopeTarget): Promise<DiscoverableSkill[]> {
  return invoke('discover_available_skills', { target });
}

export async function installSkill(
  skill: DiscoverableSkill,
  target: ScopeTarget,
  initialLocation: SkillLocation,
): Promise<InstalledSkill> {
  return invoke('install_skill', { skill, target, initialLocation });
}

export async function uninstallSkill(
  id: string,
  target: ScopeTarget,
): Promise<SkillUninstallResult> {
  return invoke('uninstall_skill', { id, target });
}

export async function getSkillPlacementTargets(
  target: ScopeTarget,
): Promise<SkillPlacementTarget[]> {
  return invoke('get_skill_placement_targets', { target });
}

export async function getSkillPlacements(context: ConfigContext): Promise<SkillPlacementAsset[]> {
  return invoke('get_skill_placements', { context });
}

export async function setSkillPlacement(
  id: string,
  target: ScopeTarget,
  location: SkillLocation,
  placed: boolean,
  expectedRevision: string,
): Promise<void> {
  return invoke('set_skill_placement', {
    id,
    target,
    location,
    placed,
    expectedRevision,
  });
}

export async function checkSkillUpdates(target: ScopeTarget): Promise<SkillUpdateInfo[]> {
  return invoke('check_skill_updates', { target });
}

export async function updateSkill(id: string, target: ScopeTarget): Promise<InstalledSkill> {
  return invoke('update_skill', { id, target });
}

export async function getSkillRepos(): Promise<SkillRepo[]> {
  return invoke('get_skill_repos');
}

export async function addSkillRepo(repo: SkillRepo): Promise<void> {
  return invoke('add_skill_repo', { repo });
}

export async function removeSkillRepo(owner: string, name: string): Promise<void> {
  return invoke('remove_skill_repo', { owner, name });
}

export async function scanUnmanagedSkills(target: ScopeTarget): Promise<UnmanagedSkill[]> {
  return invoke('scan_unmanaged_skills', { target });
}

export async function importSkillsFromApps(
  selections: ImportSkillSelection[],
  target: ScopeTarget,
  expectedRevision: string,
): Promise<InstalledSkill[]> {
  return invoke('import_skills_from_apps', { selections, target, expectedRevision });
}

export async function previewSkillImport(
  selections: ImportSkillSelection[],
  target: ScopeTarget,
): Promise<SkillImportPreview> {
  return invoke('preview_skill_import', { selections, target });
}

export async function installSkillsFromZip(
  filePath: string,
  initialLocation: SkillLocation,
  target: ScopeTarget,
): Promise<InstalledSkill[]> {
  return invoke('install_skills_from_zip', { filePath, initialLocation, target });
}

export async function getSkillBackups(target: ScopeTarget): Promise<SkillBackupEntry[]> {
  return invoke('get_skill_backups', { target });
}

export async function restoreSkillBackup(
  backupId: string,
  target: ScopeTarget,
): Promise<InstalledSkill> {
  return invoke('restore_skill_backup', { backupId, target });
}

export async function deleteSkillBackup(backupId: string, target: ScopeTarget): Promise<void> {
  return invoke('delete_skill_backup', { backupId, target });
}

export async function getSkillMatrix(
  context: ConfigContext,
): Promise<import('../../types').SkillMatrixRow[]> {
  return invoke('get_skill_matrix', { context });
}
export async function applySkillAssignments(
  requests: import('../../types').SkillAssignment[],
): Promise<import('../../types').SkillAssignmentResult[]> {
  return invoke('apply_skill_assignments', { requests });
}
export async function previewSkillAssignments(
  requests: import('../../types').SkillAssignment[],
): Promise<import('../../types').SkillAssignmentPreview[]> {
  return invoke('preview_skill_assignments', { requests });
}

export async function getCodexProjectLaunch(
  projectId: string,
): Promise<import('../../types').CodexProjectLaunchPlan> {
  return invoke('get_codex_project_launch', { projectId });
}
export async function launchCodexProject(
  projectId: string,
  expectedRevision: string,
): Promise<{ handedOff: boolean }> {
  return invoke('launch_codex_project', { projectId, expectedRevision });
}
