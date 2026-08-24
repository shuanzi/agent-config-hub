import { describe, expect, it } from 'vitest';
import { parseStructuredError, toUserError } from '../../../src/lib/errors';

describe('parseStructuredError', () => {
  it('parses a valid structured error JSON', () => {
    const error = JSON.stringify({
      code: 'SKILL_DIRECTORY_CONFLICT',
      context: { directory: 'foo', existingRepo: 'a/b' },
      suggestion: 'uninstallFirst',
    });
    const parsed = parseStructuredError(error);
    expect(parsed).toEqual({
      code: 'SKILL_DIRECTORY_CONFLICT',
      context: { directory: 'foo', existingRepo: 'a/b' },
      suggestion: 'uninstallFirst',
    });
  });

  it('returns null for plain text errors', () => {
    expect(parseStructuredError('something went wrong')).toBeNull();
  });

  it('returns null for JSON without code/context', () => {
    expect(parseStructuredError(JSON.stringify({ message: 'bad' }))).toBeNull();
  });
});

describe('toUserError', () => {
  it('maps known structured error code to a readable message', () => {
    const error = new Error(
      JSON.stringify({
        code: 'DOWNLOAD_TIMEOUT',
        context: {},
        suggestion: 'retryLater',
      }),
    );
    const userError = toUserError(error);
    expect(userError.message).toContain('下载仓库超时');
    expect(userError.suggestion).toContain('稍后重试');
  });

  it('renders context for SKILL_DIRECTORY_CONFLICT', () => {
    const error = new Error(
      JSON.stringify({
        code: 'SKILL_DIRECTORY_CONFLICT',
        context: { directory: 'my-skill', existingRepo: 'other/repo' },
        suggestion: 'uninstallFirst',
      }),
    );
    const userError = toUserError(error);
    expect(userError.message).toContain('my-skill');
    expect(userError.message).toContain('other/repo');
    expect(userError.suggestion).toContain('请先卸载');
  });

  it('hides raw exception text for unknown errors', () => {
    const userError = toUserError(new Error('internal stack trace goes here'));
    expect(userError.message).toBe('操作失败，请稍后重试。');
    expect(userError.message).not.toContain('internal stack trace');
  });

  it('hides raw text for non-Error unknown values', () => {
    const userError = toUserError('raw failure text');
    expect(userError.message).toBe('操作失败，请稍后重试。');
  });

  it('passes structured errors through without nesting', () => {
    const error = new Error(
      JSON.stringify({
        code: 'SKILL_DIRECTORY_CONFLICT',
        context: { directory: 'foo', existingRepo: 'a/b' },
        suggestion: 'uninstallFirst',
      }),
    );
    const userError = toUserError(error);
    expect(userError.message).toContain('foo');
    expect(userError.message).toContain('a/b');
    expect(userError.suggestion).toContain('请先卸载');
  });

  it('maps internal domain errors to generic messages', () => {
    const error = new Error(
      JSON.stringify({ code: 'SKILL_INTERNAL', context: {}, suggestion: 'checkLogs' }),
    );
    const userError = toUserError(error);
    expect(userError.message).toBe('Skill 操作失败。');
    expect(userError.suggestion).toBe('请检查日志或重试。');
  });

  it('renders context for IMPORT_DUPLICATE_DIRECTORY', () => {
    const error = new Error(
      JSON.stringify({
        code: 'IMPORT_DUPLICATE_DIRECTORY',
        context: { directory: 'shared' },
      }),
    );
    const userError = toUserError(error);
    expect(userError.message).toContain('一次只能导入一个来源');
    expect(userError.message).toContain('shared');
  });

  it('renders context for SKILL_STORAGE_OVERLAP', () => {
    const error = new Error(
      JSON.stringify({
        code: 'SKILL_STORAGE_OVERLAP',
        context: { app: 'codex', ssotDir: '/a', appDir: '/a/b' },
      }),
    );
    const userError = toUserError(error);
    expect(userError.message).toContain('存储目录重叠');
    expect(userError.message).toContain('codex');
  });
});
