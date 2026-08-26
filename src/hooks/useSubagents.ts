import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as subagentsApi from '../lib/api/subagents';
import type {
  AgentType,
  ConfigContext,
  DiscoverableSubagent,
  ScopeTarget,
  SubagentRepo,
} from '../types';

const keys = {
  installed: (context: ConfigContext, activeApp: AgentType) =>
    ['subagents', 'installed', context, activeApp] as const,
  discoverable: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['subagents', 'discoverable', target, activeApp] as const,
  repos: ['subagents', 'repos'] as const,
  backups: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['subagents', 'backups', target, activeApp] as const,
  updates: (target: ScopeTarget | null, activeApp: AgentType) =>
    ['subagents', 'updates', target, activeApp] as const,
};

function invalidateSubagentQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ['subagents'] });
}

export function useInstalledSubagents(
  context: ConfigContext = { kind: 'global' },
  activeApp: AgentType = 'claude-code',
) {
  return useQuery({
    queryKey: keys.installed(context, activeApp),
    queryFn: () => subagentsApi.getInstalledSubagents(context),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableSubagents(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.discoverable(target, activeApp),
    queryFn: (): Promise<DiscoverableSubagent[]> =>
      target === null ? Promise.resolve([]) : subagentsApi.discoverAvailableSubagents(target),
    enabled: target !== null,
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

export function useSubagentBackups(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.backups(target, activeApp),
    queryFn: () =>
      target === null ? Promise.resolve([]) : subagentsApi.getSubagentBackups(target),
    enabled: false,
  });
}

export function useCheckSubagentUpdates(target: ScopeTarget | null, activeApp: AgentType) {
  return useQuery({
    queryKey: keys.updates(target, activeApp),
    queryFn: () =>
      target === null ? Promise.resolve([]) : subagentsApi.checkSubagentUpdates(target),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstallSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      subagent,
      target,
      currentApp,
    }: {
      subagent: DiscoverableSubagent;
      target: ScopeTarget;
      currentApp: AgentType;
    }) => subagentsApi.installSubagent(subagent, target, currentApp),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export function useUninstallSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: ScopeTarget }) =>
      subagentsApi.uninstallSubagent(id, target),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export function useToggleSubagentApp() {
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
    }) => subagentsApi.toggleSubagentApp(id, target, app, enabled),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export function useUpdateSubagent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: ScopeTarget }) =>
      subagentsApi.updateSubagent(id, target),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export function useAddSubagentRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subagentsApi.addSubagentRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.repos });
      queryClient.invalidateQueries({ queryKey: ['subagents', 'discoverable'] });
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
      queryClient.invalidateQueries({ queryKey: ['subagents', 'discoverable'] });
    },
  });
}

export function useRestoreSubagentBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, target }: { backupId: string; target: ScopeTarget }) =>
      subagentsApi.restoreSubagentBackup(backupId, target),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export function useDeleteSubagentBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, target }: { backupId: string; target: ScopeTarget }) =>
      subagentsApi.deleteSubagentBackup(backupId, target),
    onSettled: () => invalidateSubagentQueries(queryClient),
  });
}

export type { SubagentRepo };
