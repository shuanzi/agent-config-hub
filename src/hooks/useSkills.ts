import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as skillsApi from '../lib/api/skills';
import type {
  AgentType,
  DiscoverableSkill,
  InstalledSkill,
  SkillBackupEntry,
  SkillRepo,
  SkillUpdateInfo,
  StorageLocation,
} from '../types';
import { mergeImportedSkills } from './useSkills.helpers';

const keys = {
  installed: ['skills', 'installed'] as const,
  discoverable: ['skills', 'discoverable'] as const,
  repos: ['skills', 'repos'] as const,
  backups: ['skills', 'backups'] as const,
  unmanaged: ['skills', 'unmanaged'] as const,
  updates: ['skills', 'updates'] as const,
};

export function useInstalledSkills() {
  return useQuery({
    queryKey: keys.installed,
    queryFn: skillsApi.getInstalledSkills,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableSkills() {
  return useQuery({
    queryKey: keys.discoverable,
    queryFn: skillsApi.discoverAvailableSkills,
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

export function useSkillBackups() {
  return useQuery({
    queryKey: keys.backups,
    queryFn: skillsApi.getSkillBackups,
    enabled: false,
  });
}

export function useScanUnmanagedSkills(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.unmanaged,
    queryFn: skillsApi.scanUnmanagedSkills,
    enabled: options?.enabled ?? false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCheckSkillUpdates() {
  return useQuery({
    queryKey: keys.updates,
    queryFn: skillsApi.checkSkillUpdates,
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skill, currentApp }: { skill: DiscoverableSkill; currentApp: AgentType }) =>
      skillsApi.installSkill(skill, currentApp),
    onSuccess: (installedSkill) => {
      queryClient.setQueryData<InstalledSkill[]>(keys.installed, (oldData) =>
        mergeImportedSkills(oldData, [installedSkill]),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.unmanaged }),
      ]),
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.uninstallSkill,
    onSuccess: (_result, id) => {
      queryClient.setQueryData<InstalledSkill[]>(keys.installed, (oldData) =>
        oldData?.filter((s) => s.id !== id),
      );
      queryClient.setQueryData<SkillUpdateInfo[]>(keys.updates, (oldData) =>
        oldData?.filter((u) => u.id !== id),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.discoverable }),
        queryClient.invalidateQueries({ queryKey: keys.backups }),
        queryClient.invalidateQueries({ queryKey: keys.unmanaged }),
      ]),
  });
}

export function useToggleSkillApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, app, enabled }: { id: string; app: AgentType; enabled: boolean }) =>
      skillsApi.toggleSkillApp(id, app, enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.installed }),
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.updateSkill,
    onSuccess: (updatedSkill) => {
      queryClient.setQueryData<InstalledSkill[]>(keys.installed, (oldData) => {
        if (oldData === undefined) return [updatedSkill];
        return oldData.map((s) => (s.id === updatedSkill.id ? updatedSkill : s));
      });
      queryClient.setQueryData<SkillUpdateInfo[]>(keys.updates, (oldData) =>
        oldData?.filter((u) => u.id !== updatedSkill.id),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.backups }),
  });
}

export function useInstallSkillsFromZip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filePath, currentApp }: { filePath: string; currentApp: AgentType }) =>
      skillsApi.installSkillsFromZip(filePath, currentApp),
    onSuccess: (installedSkills) => {
      queryClient.setQueryData<InstalledSkill[]>(keys.installed, (oldData) =>
        mergeImportedSkills(oldData, installedSkills),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.unmanaged }),
      ]),
  });
}

export function useImportSkillsFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.importSkillsFromApps,
    onSuccess: (importedSkills) => {
      queryClient.setQueryData<InstalledSkill[]>(keys.installed, (oldData) =>
        mergeImportedSkills(oldData, importedSkills),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.unmanaged }),
        queryClient.invalidateQueries({ queryKey: keys.repos }),
        queryClient.invalidateQueries({ queryKey: keys.discoverable }),
      ]),
  });
}

export function useAddSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.addSkillRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.repos });
      queryClient.invalidateQueries({ queryKey: keys.discoverable });
    },
  });
}

export function useRemoveSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      skillsApi.removeSkillRepo(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.repos });
      queryClient.invalidateQueries({ queryKey: keys.discoverable });
    },
  });
}

export function useRestoreSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, currentApp }: { backupId: string; currentApp: AgentType }) =>
      skillsApi.restoreSkillBackup(backupId, currentApp),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.backups }),
      ]),
  });
}

export function useDeleteSkillBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.deleteSkillBackup,
    onSuccess: (_result, backupId) => {
      queryClient.setQueryData<SkillBackupEntry[]>(keys.backups, (oldData) =>
        oldData?.filter((b) => b.backupId !== backupId),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.backups }),
  });
}

export function useMigrateSkillStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: StorageLocation) => skillsApi.migrateSkillStorage(target),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.installed }),
  });
}

export type { SkillRepo };
