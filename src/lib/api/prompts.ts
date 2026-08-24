import { invoke } from './invoke';
import type { AgentType, Prompt } from '../../types';

export async function getPrompts(app: AgentType): Promise<Record<string, Prompt>> {
  return invoke('get_prompts', { app });
}

export async function upsertPrompt(app: AgentType, id: string, prompt: Prompt): Promise<void> {
  return invoke('upsert_prompt', { app, id, prompt });
}

export async function deletePrompt(app: AgentType, id: string): Promise<void> {
  return invoke('delete_prompt', { app, id });
}

export async function enablePrompt(app: AgentType, id: string): Promise<void> {
  return invoke('enable_prompt', { app, id });
}

export async function importPromptFromFile(app: AgentType): Promise<string> {
  return invoke('import_prompt_from_file', { app });
}

export async function getCurrentPromptFileContent(app: AgentType): Promise<string | null> {
  return invoke('get_current_prompt_file_content', { app });
}
