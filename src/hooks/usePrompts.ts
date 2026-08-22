import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { AgentType, Prompt } from '../types';
import * as promptsApi from '../lib/api/prompts';

const keys = {
  prompts: (app: AgentType) => ['prompts', app] as const,
  currentFile: (app: AgentType) => ['prompts', 'currentFile', app] as const,
};

export function usePrompts(app: AgentType) {
  return useQuery({
    queryKey: keys.prompts(app),
    queryFn: () => promptsApi.getPrompts(app),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useCurrentPromptFileContent(app: AgentType) {
  return useQuery({
    queryKey: keys.currentFile(app),
    queryFn: () => promptsApi.getCurrentPromptFileContent(app),
    staleTime: 5 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useSavePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id, prompt }: { app: AgentType; id: string; prompt: Prompt }) =>
      promptsApi.upsertPrompt(app, id, prompt),
    onSuccess: (_result, { app, id, prompt }) => {
      queryClient.setQueryData<Record<string, Prompt>>(keys.prompts(app), (oldData) => ({
        ...oldData,
        [id]: prompt,
      }));
      queryClient.invalidateQueries({ queryKey: keys.prompts(app) });
      queryClient.invalidateQueries({ queryKey: keys.currentFile(app) });
    },
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: AgentType; id: string }) => promptsApi.deletePrompt(app, id),
    onSuccess: (_result, { app, id }) => {
      queryClient.setQueryData<Record<string, Prompt>>(keys.prompts(app), (oldData) => {
        if (!oldData) return oldData;
        const next = { ...oldData };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: keys.prompts(app) });
      queryClient.invalidateQueries({ queryKey: keys.currentFile(app) });
    },
  });
}

export function useEnablePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ app, id }: { app: AgentType; id: string }) => promptsApi.enablePrompt(app, id),
    onSuccess: (_result, { app, id }) => {
      queryClient.setQueryData<Record<string, Prompt>>(keys.prompts(app), (oldData) => {
        if (!oldData) return oldData;
        return Object.fromEntries(
          Object.entries(oldData).map(([key, prompt]) => [key, { ...prompt, enabled: key === id }]),
        );
      });
      queryClient.invalidateQueries({ queryKey: keys.prompts(app) });
      queryClient.invalidateQueries({ queryKey: keys.currentFile(app) });
    },
  });
}

export function useImportPromptFromFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ app }: { app: AgentType }) => promptsApi.importPromptFromFile(app),
    onSuccess: (_result, { app }) => {
      queryClient.invalidateQueries({ queryKey: keys.prompts(app) });
      queryClient.invalidateQueries({ queryKey: keys.currentFile(app) });
    },
  });
}
