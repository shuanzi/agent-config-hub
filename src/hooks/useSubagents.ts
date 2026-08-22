import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as subagentsApi from '../lib/api/subagents';
import type {
  AgentType,
  DiscoverableSubagent,
  InstalledSubagent,
  SubagentBackupEntry,
  SubagentRepo,
  SubagentUpdateInfo,
  StorageLocation,
} from '../types';
import { mergeImportedSubagents } from './useSubagents.helpers';

const keys = {
  installed: ['subagents', 'installed'] as const,
  discoverable: ['subagents', 'discoverable'] as const,
  repos: ['subagents', 'repos'] as const,
  backups: ['subagents', 'backups'] as const,
  updates: ['subagents', 'updates'] as const,
};

export function useInstalledSubagents() {
  return useQuery({
    queryKey: keys.installed,
    queryFn: subagentsApi.getInstalledSubagents,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableSubagents() {
  return useQuery({
    queryKey: keys.discoverable,
    queryFn: subagentsApi.discoverAvailableSubagents,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useSubagentRepos() {
  return useQuery({
    queryKey: keys.repos,
    queryFn: subagentsApi.getSubagentRepos,
  });
}

export function useSubagentBackups() {
  return useQuery({
    queryKey: keys.backups,
    queryFn: subagentsApi.getSubagentBackups,
    enabled: false,
  });
}

export function useCheckSubagentUpdates() {
  return useQuery({
    queryKey: keys.updates,
    queryFn: subagentsApi.checkSubagentUpdates,
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstallSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      subagent,
      currentApp,
    }: {
      subagent: DiscoverableSubagent;
      currentApp: AgentType;
    }) => subagentsApi.installSubagent(subagent, currentApp),
    onSuccess: (installedSubagent) => {
      queryClient.setQueryData<InstalledSubagent[]>(keys.installed, (oldData) =>
        mergeImportedSubagents(oldData, [installedSubagent]),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.discoverable }),
      ]),
  });
}

export function useUninstallSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subagentsApi.uninstallSubagent,
    onSuccess: (_result, id) => {
      queryClient.setQueryData<InstalledSubagent[]>(keys.installed, (oldData) =>
        oldData?.filter((s) => s.id !== id),
      );
      queryClient.setQueryData<SubagentUpdateInfo[]>(keys.updates, (oldData) =>
        oldData?.filter((u) => u.id !== id),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.discoverable }),
        queryClient.invalidateQueries({ queryKey: keys.backups }),
      ]),
  });
}

export function useToggleSubagentApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, app, enabled }: { id: string; app: AgentType; enabled: boolean }) =>
      subagentsApi.toggleSubagentApp(id, app, enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.installed }),
  });
}

export function useUpdateSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subagentsApi.updateSubagent,
    onSuccess: (updatedSubagent) => {
      queryClient.setQueryData<InstalledSubagent[]>(keys.installed, (oldData) => {
        if (oldData === undefined) return [updatedSubagent];
        return oldData.map((s) => (s.id === updatedSubagent.id ? updatedSubagent : s));
      });
      queryClient.setQueryData<SubagentUpdateInfo[]>(keys.updates, (oldData) =>
        oldData?.filter((u) => u.id !== updatedSubagent.id),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.backups }),
  });
}

export function useAddSubagentRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subagentsApi.addSubagentRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.repos });
      queryClient.invalidateQueries({ queryKey: keys.discoverable });
    },
  });
}

export function useRemoveSubagentRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      subagentsApi.removeSubagentRepo(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.repos });
      queryClient.invalidateQueries({ queryKey: keys.discoverable });
    },
  });
}

export function useRestoreSubagentBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, currentApp }: { backupId: string; currentApp: AgentType }) =>
      subagentsApi.restoreSubagentBackup(backupId, currentApp),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.installed }),
        queryClient.invalidateQueries({ queryKey: keys.backups }),
      ]),
  });
}

export function useDeleteSubagentBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subagentsApi.deleteSubagentBackup,
    onSuccess: (_result, backupId) => {
      queryClient.setQueryData<SubagentBackupEntry[]>(keys.backups, (oldData) =>
        oldData?.filter((b) => b.backupId !== backupId),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.backups }),
  });
}

export function useMigrateSubagentStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: StorageLocation) => subagentsApi.migrateSubagentStorage(target),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.installed }),
  });
}

export type { SubagentRepo };
