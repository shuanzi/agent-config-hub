import type { StructuredError } from '../types';

export interface UserError {
  message: string;
  suggestion?: string;
}

const ERROR_MESSAGES: Record<string, string | ((ctx: Record<string, string>) => string)> = {
  SKILL_NOT_FOUND: 'Skill 不存在。',
  MISSING_REPO_INFO: '缺少仓库信息。',
  DOWNLOAD_TIMEOUT: '下载仓库超时，请检查网络后重试。',
  DOWNLOAD_FAILED: '下载仓库失败。',
  SKILL_DIR_NOT_FOUND: '未在仓库中找到该 Skill 目录。',
  SKILL_DIRECTORY_CONFLICT: (ctx) =>
    `目录冲突：${ctx.directory ?? ''} 已被其他仓库占用（${ctx.existingRepo ?? 'unknown'}），请先卸载后再安装。`,
  EMPTY_ARCHIVE: '下载的归档为空。',
  INVALID_REPO_REF: '非法的仓库坐标。',
  INVALID_SKILL_DIRECTORY: '非法的 Skill 目录。',
  ARCHIVE_TOO_LARGE: '归档超过大小限制。',
  ARCHIVE_TOO_MANY_ENTRIES: '归档条目数超过限制。',
  GET_HOME_DIR_FAILED: '无法获取用户主目录。',
  NO_SKILLS_IN_ZIP: 'ZIP 文件中未找到有效的 Skill。',
  INVALID_APP_TYPE: (ctx) => `不支持的 Agent 类型：${ctx.app ?? 'unknown'}。`,
  'skill/error': (ctx) => ctx.message ?? 'Skill 操作失败。',
  'settings/error': (ctx) => ctx.message ?? '设置操作失败。',
};

const SUGGESTION_MESSAGES: Record<string, string> = {
  checkNetwork: '请检查网络连接后重试。',
  checkProxy: '请检查代理设置。',
  retryLater: '请稍后重试。',
  checkRepoUrl: '请确认仓库地址与分支是否正确。',
  checkPermission: '请检查文件权限。',
  uninstallFirst: '请先卸载冲突的 Skill，或选择其他目录名。',
  checkZipContent: '请检查 ZIP 内容是否包含有效的 SKILL.md。',
  http403: '服务器返回 403，请检查访问权限。',
  http404: '服务器返回 404，请确认仓库存在。',
  http429: '请求过于频繁，请稍后重试。',
};

/**
 * 尝试解析后端返回的结构化错误字符串 `{code, context, suggestion}`。
 * 解析失败返回 null。
 */
export function parseStructuredError(errorString: string): StructuredError | null {
  try {
    const parsed = JSON.parse(errorString);
    if (typeof parsed.code === 'string' && parsed.context !== undefined) {
      return parsed as StructuredError;
    }
  } catch {
    // 非 JSON 格式，继续走未知错误路径
  }
  return null;
}

/**
 * 将任意错误转换为面向用户的可读消息。
 * 已知结构化错误给出对应说明与建议；未知错误返回通用提示，不暴露原始异常文本。
 */
export function toUserError(error: unknown): UserError {
  const errorString = error instanceof Error ? error.message : String(error);
  const parsed = parseStructuredError(errorString);

  if (parsed !== null) {
    const mapping = ERROR_MESSAGES[parsed.code];
    const message =
      typeof mapping === 'function'
        ? mapping(parsed.context ?? {})
        : (mapping ?? parsed.context.message ?? parsed.code);
    const suggestion =
      parsed.suggestion !== undefined ? SUGGESTION_MESSAGES[parsed.suggestion] : undefined;
    return { message, suggestion };
  }

  return { message: '操作失败，请稍后重试。' };
}
