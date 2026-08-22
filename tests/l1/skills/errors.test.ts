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
});
