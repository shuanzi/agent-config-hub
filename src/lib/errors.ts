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
    ctx.existingRepo === 'unmanaged'
      ? `目录冲突：${ctx.directory ?? ''} 在目标位置已存在未托管内容，不会被覆盖。`
      : `目录冲突：${ctx.directory ?? ''} 已被其他仓库占用（${ctx.existingRepo ?? 'unknown'}），请先卸载后再安装。`,
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
  SKILL_INTERNAL: 'Skill 操作失败。',
  PROMPT_INTERNAL: 'Prompt 操作失败。',
  INSTRUCTION_PROJECTIONS_DIVERGED:
    'Codex 与 OpenCode 的 AGENTS.md 内容不一致，请先在磁盘统一后重试。',
  PROJECT_ROOT_UNAVAILABLE: (ctx) =>
    ctx.rootPath
      ? `项目目录不可用：${ctx.rootPath}。`
      : '项目目录不可用，请重新关联项目目录后重试。',
  PROJECT_HAS_NATIVE_SUBAGENT_STATE:
    '项目仍有受管原生 Subagent 或其备份，暂不能移除或重新关联目录，以免原生文件和备份失去归属。',
  SUBAGENT_INTERNAL: 'Subagent 操作失败。',
  NATIVE_SUBAGENT_INTERNAL: '原生 Subagent 操作失败，请检查配置路径与文件权限后重试。',
  NATIVE_SUBAGENT_EXTERNAL_MODIFICATION:
    '文件已被外部修改，本次操作未覆盖文件。请重新加载后再操作。',
  NATIVE_SUBAGENT_REMOTE_CHANGED: '仓库内容在预览后发生变化，请重新检查更新并审阅差异。',
  NATIVE_SUBAGENT_DESTINATION_CONFLICT: '目标路径已被占用，本次操作不会覆盖已有文件。',
  NATIVE_SUBAGENT_RESTORE_CONFLICT: '恢复目标已变化或被其他文件占用，请刷新并核对目标后重试。',
  NATIVE_SUBAGENT_DISABLED_DESTINATION_CONFLICT:
    '该定义仍有停用副本，请先启用或备份并卸载后再恢复，避免产生两个版本。',
  NATIVE_SUBAGENT_DISCOVERY_FAILED: '原生定义发现失败，请检查仓库配置与网络后重新刷新。',
  NATIVE_SUBAGENT_SOURCE_OUTSIDE_CURRENT_SCOPE:
    '配置目录已变更，原来源不再属于当前目标。本次操作未写入旧路径，请核对目录设置。',
  NATIVE_SUBAGENT_NOT_MANAGED: '该定义尚未纳入管理，请先显式接管。',
  NATIVE_SUBAGENT_INVALID: (ctx) => `原生格式校验失败：${ctx.message ?? '请检查必要字段和语法。'}`,
  NATIVE_SUBAGENT_INCOMPATIBLE_AGENT: '该原生定义与所选 Agent 不兼容，不会进行格式转换。',
  NATIVE_SUBAGENT_LEGACY_REVIEW_REQUIRED: '旧版记录需先核对原生文件，不会自动恢复跨 Agent 投影。',
  NATIVE_SUBAGENT_SYMLINK_CONFIRMATION_REQUIRED: '请先核对并确认符号链接的实际目标。',
  NATIVE_SUBAGENT_SYMLINK_READ_ONLY: '该来源是符号链接，不能隐式修改外部目标，请重新核对接管状态。',
  NATIVE_SUBAGENT_ANCESTOR_SYMLINK_UNSAFE:
    '来源的父目录是符号链接，目前仅允许只读查看。请使用普通配置目录后再纳入管理，避免修改外部目录。',
  NATIVE_SUBAGENT_CONFIG_DOCUMENT_MISSING: '原生配置文件已不存在，请恢复配置文件后重试。',
  SETTINGS_INTERNAL: '设置操作失败。',
  MIGRATION_ABORTED: (ctx) => `迁移失败：${ctx.failures ?? ''}`,
  IMPORT_DUPLICATE_DIRECTORY: (ctx) => `同名 Skill 一次只能导入一个来源：${ctx.directory ?? ''}。`,
  SKILL_STORAGE_OVERLAP: (ctx) =>
    `存储目录重叠：${ctx.app ?? ''} 的 Skills 目录与 Skill 存储位置存在包含关系，请调整覆盖目录。`,
  SUBAGENT_STORAGE_OVERLAP: (ctx) =>
    `存储目录重叠：${ctx.app ?? ''} 的 Agents 目录与 Subagent 存储位置存在包含关系，请调整覆盖目录。`,
  UPDATE_SYNC_FAILED: (ctx) => `更新后同步失败：${ctx.apps ?? ''}`,
  UNINSTALL_PROJECTION_FAILED: (ctx) => `移除投影失败：${ctx.apps ?? ''}`,
};

const SUGGESTION_MESSAGES: Record<string, string> = {
  checkNetwork: '请检查网络连接后重试。',
  checkProxy: '请检查代理设置。',
  retryLater: '请稍后重试。',
  checkRepoUrl: '请确认仓库地址与分支是否正确。',
  checkPermission: '请检查文件权限。',
  uninstallFirst: '请先卸载冲突的 Skill，或选择其他目录名。',
  importFirst: '请先通过「导入」纳管该目录，或手动删除后再安装。',
  checkZipContent: '请检查 ZIP 内容是否包含有效的 SKILL.md。',
  http403: '服务器返回 403，请检查访问权限。',
  http404: '服务器返回 404，请确认仓库存在。',
  http429: '请求过于频繁，请稍后重试。',
  checkLogs: '请检查日志或重试。',
  relinkProject: '请重新关联项目目录后重试。',
  selectExistingDirectory: '请选择一个存在的项目目录。',
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
