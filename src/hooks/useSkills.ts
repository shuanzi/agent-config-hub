import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as skillsApi from '../lib/api/skills';
import type { AgentType, ConfigContext, DiscoverableSkill, ScopeTarget, SkillRepo } from '../types';

const keys = {
  installed: (context: ConfigContext, activeApp: AgentType) =>
    ['skills', 'installed', context, activeApp] as const,
  discoverable: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['skills', 'discoverable', target, activeApp] as const,
  repos: ['skills', 'repos'] as const,
  backups: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['skills', 'backups', target, activeApp] as const,
  unmanaged: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['skills', 'unmanaged', target, activeApp] as const,
  updates: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['skills', 'updates', target, activeApp] as const,
};

function invalidateSkillQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ['skills'] });
}

export function useInstalledSkills(
  context: ConfigContext = { kind: 'global' },
  activeApp: AgentType = 'claude-code',
) {
  return useQuery({
    queryKey: keys.installed(context, activeApp),
    queryFn: () => skillsApi.getInstalledSkills(context),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableSkills(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.discoverable(target, activeApp),
    queryFn: (): Promise<DiscoverableSkill[]> =>
      target === null ? Promise.resolve([]) : skillsApi.discoverAvailableSkills(target),
    enabled: target !== null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useSkillRepos() {
  return useQuery({
    queryKey: keys.repos,
    queryFn: skillsApi.getSkillRepos,
  });
}

export function useSkillBackups(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.backups(target, activeApp),
    queryFn: () => (target === null ? Promise.resolve([]) : skillsApi.getSkillBackups(target)),
    enabled: false,
  });
}

export function useScanUnmanagedSkills(
  target: ScopeTarget | null,
  activeApp: AgentType,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: keys.unmanaged(target, activeApp),
    queryFn: () => (target === null ? Promise.resolve([]) : skillsApi.scanUnmanagedSkills(target)),
    enabled: target !== null && (options?.enabled ?? false),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCheckSkillUpdates(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.updates(target, activeApp),
    queryFn: () => (target === null ? Promise.resolve([]) : skillsApi.checkSkillUpdates(target)),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skill,
      target,
      currentApp,
    }: {
      skill: DiscoverableSkill;
      target: ScopeTarget;
      currentApp: AgentType;
    }) => skillsApi.installSkill(skill, target, currentApp),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: ScopeTarget }) =>
      skillsApi.uninstallSkill(id, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useToggleSkillApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      app,
      enabled,
    }: {
      id: string;
      target: ScopeTarget;
      app: AgentType;
      enabled: boolean;
    }) => skillsApi.toggleSkillApp(id, target, app, enabled),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: ScopeTarget }) =>
      skillsApi.updateSkill(id, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useInstallSkillsFromZip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      filePath,
      currentApp,
      target,
    }: {
      filePath: string;
      currentApp: AgentType;
      target: ScopeTarget;
    }) => skillsApi.installSkillsFromZip(filePath, currentApp, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useImportSkillsFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      selections,
      target,
    }: {
      selections: Parameters<typeof skillsApi.importSkillsFromApps>[0];
      target: ScopeTarget;
    }) => skillsApi.importSkillsFromApps(selections, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useAddSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.addSkillRepo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills', 'discoverable'] }),
  });
}

export function useRemoveSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      skillsApi.removeSkillRepo(owner, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills', 'discoverable'] }),
  });
}

export function useRestoreSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, target }: { backupId: string; target: ScopeTarget }) =>
      skillsApi.restoreSkillBackup(backupId, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useDeleteSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, target }: { backupId: string; target: ScopeTarget }) =>
      skillsApi.deleteSkillBackup(backupId, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export type { SkillRepo };
