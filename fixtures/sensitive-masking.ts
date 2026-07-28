/**
 * 合成敏感值遮蔽（FE-01）。
 *
 * mock gateway 与真实 Rust core 对同一份合成 fixture 实现同一遮蔽语义：
 * 形如 `SYNTHETIC-SECRET-<suffix>` 的占位值在离开 gateway 前被替换为固定
 * 遮蔽标记。遮蔽发生在 gateway 边界内；UI、测试输出、日志与 evidence
 * 任何时候都不得出现占位明文。
 *
 * 注意：本模块只识别合成 fixture 占位模式，不构成真实敏感信息识别器；
 * 真实识别能力属于后续 core 票据。
 */

/** 离开 gateway 的固定遮蔽标记 */
export const SENSITIVE_MASK = '••••••••';

/** 合成占位值模式（只匹配 fixture 占位值，不匹配真实 Token） */
const SYNTHETIC_SECRET_PATTERN = /SYNTHETIC-SECRET-[A-Za-z0-9][A-Za-z0-9-]*/g;

/** 对原始文本执行默认遮蔽，返回可安全离开 gateway 的文本 */
export function maskSyntheticSecrets(rawText: string): string {
  return rawText.replace(SYNTHETIC_SECRET_PATTERN, SENSITIVE_MASK);
}

/** 断言辅助：文本中不存在任何合成占位明文 */
export function containsSyntheticSecret(text: string): boolean {
  return new RegExp(SYNTHETIC_SECRET_PATTERN.source).test(text);
}
