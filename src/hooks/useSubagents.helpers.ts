import type { InstalledSubagent } from '../types';

/**
 * 合并安装结果到已安装缓存，按 id 去重。
 * 空结果时保持原引用，避免 React Query 触发无意义通知。
 */
export function mergeImportedSubagents(
  existing: InstalledSubagent[] | undefined,
  imported: InstalledSubagent[],
): InstalledSubagent[] {
  if (imported.length === 0) return existing ?? imported;

  const merged = new Map(existing?.map((subagent) => [subagent.id, subagent]));
  for (const subagent of imported) {
    merged.set(subagent.id, subagent);
  }
  return Array.from(merged.values());
}
