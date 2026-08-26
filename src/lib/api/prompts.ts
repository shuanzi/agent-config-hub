import { invoke } from './invoke';
import type {
  ConfigContext,
  InstructionDocument,
  InstructionDocumentKind,
  ScopeTarget,
} from '../../types';

export async function getInstructionDocuments(
  context: ConfigContext,
): Promise<InstructionDocument[]> {
  return invoke('get_instruction_documents', { context });
}

export async function upsertInstructionDocument(
  target: ScopeTarget,
  kind: InstructionDocumentKind,
  content: string,
): Promise<void> {
  return invoke('upsert_instruction_document', { target, kind, content });
}
