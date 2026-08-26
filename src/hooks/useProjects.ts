import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as projectsApi from '../lib/api/projects';

const projectsKey = ['projects'] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: projectsApi.listProjects,
    staleTime: Infinity,
  });
}

export function useAddProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.addProject,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['subagents'] }),
        queryClient.invalidateQueries({ queryKey: ['instruction-documents'] }),
      ]),
  });
}

export function useRelinkProjectRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.relinkProjectRoot,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['subagents'] }),
        queryClient.invalidateQueries({ queryKey: ['instruction-documents'] }),
      ]),
  });
}

export function useRemoveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.removeProject,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['subagents'] }),
        queryClient.invalidateQueries({ queryKey: ['instruction-documents'] }),
      ]),
  });
}
