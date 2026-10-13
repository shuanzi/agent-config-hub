import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as skillsApi from '../lib/api/skills';
import type {
  ConfigContext,
  DiscoverableSkill,
  ScopeTarget,
  SkillLocation,
  SkillRepo,
  SkillUpdateInfo,
} from '../types';

const keys = {
  installed: (context: ConfigContext) => ['skills', 'installed', context] as const,
  discoverable: (target: ScopeTarget | null) => ['skills', 'discoverable', target] as const,
  repos: ['skills', 'repos'] as const,
  backups: (target: ScopeTarget | null) => ['skills', 'backups', target] as const,
  unmanaged: (target: ScopeTarget | null) => ['skills', 'unmanaged', target] as const,
  updates: (target: ScopeTarget | null) => ['skills', 'updates', target] as const,
  placementTargets: (target: ScopeTarget | null) =>
    ['skills', 'placement-targets', target] as const,
  placements: (context: ConfigContext) => ['skills', 'placements', context] as const,
};

function invalidateSkillQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ['skills'] });
}

export function useInstalledSkills(context: ConfigContext = { kind: 'global' }) {
  return useQuery({
    queryKey: keys.installed(context),
    queryFn: () => skillsApi.getInstalledSkills(context),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useSkillPlacementTargets(target: ScopeTarget | null) {
  return useQuery({
    queryKey: keys.placementTargets(target),
    queryFn: () =>
      target === null ? Promise.resolve([]) : skillsApi.getSkillPlacementTargets(target),
    enabled: target !== null,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useSkillPlacements(context: ConfigContext = { kind: 'global' }) {
  return useQuery({
    queryKey: keys.placements(context),
    queryFn: () => skillsApi.getSkillPlacements(context),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableSkills(target: ScopeTarget | null) {
  return useQuery({
    queryKey: keys.discoverable(target),
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

export function useSkillBackups(target: ScopeTarget | null) {
  return useQuery({
    queryKey: keys.backups(target),
    queryFn: () => (target === null ? Promise.resolve([]) : skillsApi.getSkillBackups(target)),
    enabled: false,
  });
}

export function useScanUnmanagedSkills(
  target: ScopeTarget | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: keys.unmanaged(target),
    queryFn: () => (target === null ? Promise.resolve([]) : skillsApi.scanUnmanagedSkills(target)),
    enabled: target !== null && (options?.enabled ?? false),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCheckSkillUpdates(target: ScopeTarget | null) {
  return useQuery({
    queryKey: keys.updates(target),
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
      initialLocation,
    }: {
      skill: DiscoverableSkill;
      target: ScopeTarget;
      initialLocation: SkillLocation;
    }) => skillsApi.installSkill(skill, target, initialLocation),
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

export function useSetSkillPlacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      location,
      placed,
      expectedRevision,
    }: {
      id: string;
      target: ScopeTarget;
      location: SkillLocation;
      placed: boolean;
      expectedRevision: string;
    }) => skillsApi.setSkillPlacement(id, target, location, placed, expectedRevision),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: ScopeTarget }) =>
      skillsApi.updateSkill(id, target),
    onSuccess: (_skill, { id, target }) => {
      queryClient.setQueryData<SkillUpdateInfo[]>(keys.updates(target), (current) =>
        current?.filter((update) => update.id !== id),
      );
    },
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useInstallSkillsFromZip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      filePath,
      initialLocation,
      target,
    }: {
      filePath: string;
      initialLocation: SkillLocation;
      target: ScopeTarget;
    }) => skillsApi.installSkillsFromZip(filePath, initialLocation, target),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function useImportSkillsFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      selections,
      target,
      expectedRevision,
    }: {
      selections: Parameters<typeof skillsApi.importSkillsFromApps>[0];
      target: ScopeTarget;
      expectedRevision: string;
    }) => skillsApi.importSkillsFromApps(selections, target, expectedRevision),
    onSettled: () => invalidateSkillQueries(queryClient),
  });
}

export function usePreviewSkillImport() {
  return useMutation({
    mutationFn: ({
      selections,
      target,
    }: {
      selections: Parameters<typeof skillsApi.previewSkillImport>[0];
      target: ScopeTarget;
    }) => skillsApi.previewSkillImport(selections, target),
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
