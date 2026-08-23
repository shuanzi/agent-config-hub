import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as settingsApi from '../lib/api/settings';
import type { StorageLocation } from '../types';

const key = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: key,
    queryFn: settingsApi.getSettings,
  });
}

export function useSetSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: settingsApi.setSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useMigrateStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: StorageLocation) => settingsApi.migrateStorage(target),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['skills', 'installed'] });
      void queryClient.invalidateQueries({ queryKey: ['subagents', 'installed'] });
    },
  });
}
