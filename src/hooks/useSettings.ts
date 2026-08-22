import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as settingsApi from '../lib/api/settings';

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
