import type { InstalledSkill } from '../types';

/**
 * 合并导入/安装结果到已安装缓存，按 id 去重。
 * 空结果时保持原引用，避免 React Query 触发无意义通知。
 */
export function mergeImportedSkills(
  existing: InstalledSkill[] | undefined,
  imported: InstalledSkill[],
): InstalledSkill[] {
  if (imported.length === 0) return existing ?? imported;

  const merged = new Map(existing?.map((skill) => [skill.id, skill]));
  for (const skill of imported) {
    merged.set(skill.id, skill);
  }
  return Array.from(merged.values());
}
