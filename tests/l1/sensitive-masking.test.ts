/**
 * L1：合成占位值遮蔽语义（与 src-tauri/tests/masking.rs 用例表一一对应）。
 * 两侧实现必须保持同一遮蔽语义，任何一侧改规则都应让对应测试变红。
 */
import { describe, expect, it } from 'vitest';
import {
  SENSITIVE_MASK,
  containsSyntheticSecret,
  maskSyntheticSecrets,
} from '../../fixtures/sensitive-masking';

describe('maskSyntheticSecrets', () => {
  it('遮蔽占位值且无残留', () => {
    const raw = ['API_KEY=', 'SYNTHETIC-SECRET', '-demo-skill-0001\n'].join('');
    const masked = maskSyntheticSecrets(raw);
    expect(masked).toBe(`API_KEY=${SENSITIVE_MASK}\n`);
    expect(masked).not.toContain('SYNTHETIC-SECRET');
    expect(masked).not.toContain('demo-skill-0001');
  });

  it('遮蔽多处出现与各种 suffix 形状', () => {
    const raw = [
      'a ',
      'SYNTHETIC-SECRET',
      '-a b ',
      'SYNTHETIC-SECRET',
      '-A0-b-2 c\n',
      'SYNTHETIC-SECRET',
      '-x',
    ].join('');
    expect(maskSyntheticSecrets(raw)).toBe(
      `a ${SENSITIVE_MASK} b ${SENSITIVE_MASK} c\n${SENSITIVE_MASK}`,
    );
  });

  it.each([
    'plain text without markers',
    ['SYNTHETIC-SECRET', '-'].join(''), // 空 suffix 不是占位值
    ['SYNTHETIC-SECRET', '-?'].join(''), // 非字母数字起始不是占位值
    ['prefix', 'SYNTHETIC-SECRET', '- ok'].join(''), // 后缀空格结尾，同样不匹配
    'SYNTHETIC-SECRETS-x', // 前缀本身不匹配
    'synthetic-secret-abc', // 大小写敏感
  ])('非占位文本保持不动: %s', (raw) => {
    expect(maskSyntheticSecrets(raw)).toBe(raw);
  });

  it('占位值邻接标点时标点保留', () => {
    const raw = ['token=(', 'SYNTHETIC-SECRET', '-ab1);'].join('');
    expect(maskSyntheticSecrets(raw)).toBe(`token=(${SENSITIVE_MASK});`);
  });
});

describe('containsSyntheticSecret', () => {
  it('检出未遮蔽占位明文', () => {
    expect(containsSyntheticSecret(['x=', 'SYNTHETIC-SECRET', '-abc'].join(''))).toBe(true);
  });

  it('已遮蔽文本与正常文本均为阴性', () => {
    expect(containsSyntheticSecret(`x=${SENSITIVE_MASK}`)).toBe(false);
    expect(containsSyntheticSecret('nothing special')).toBe(false);
  });
});
