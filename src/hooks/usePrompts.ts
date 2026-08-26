import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigContext, InstructionDocumentKind, ScopeTarget } from '../types';
import * as promptsApi from '../lib/api/prompts';

const keys = {
  documents: ['instruction-documents'] as const,
  context: (context: ConfigContext) => ['instruction-documents', context] as const,
};

export function useInstructionDocuments(context: ConfigContext) {
  return useQuery({
    queryKey: keys.context(context),
    queryFn: () => promptsApi.getInstructionDocuments(context),
    staleTime: Infinity,
  });
}

export function useSaveInstructionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      target,
      kind,
      content,
    }: {
      target: ScopeTarget;
      kind: InstructionDocumentKind;
      content: string;
    }) => promptsApi.upsertInstructionDocument(target, kind, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.documents });
    },
  });
}
