import type { QueryClient } from '@tanstack/react-query';
import type { NativeSubagentContent } from '../../lib/api/nativeSubagents';
export interface NativeDraft {
  loaded: NativeSubagentContent;
  text: string;
}
// 会话内按后端 identity 暂存。不落盘、不更新原始摘要，不跨 App 实例共享。
const sessions = new WeakMap<QueryClient, Map<string, NativeDraft>>();
export function nativeDrafts(client: QueryClient) {
  let drafts = sessions.get(client);
  if (!drafts) {
    drafts = new Map();
    sessions.set(client, drafts);
  }
  return drafts;
}
