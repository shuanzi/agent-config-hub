// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.artifacts/**',
      'src-tauri/**',
      'target/**',
      'docs/**',
      '.scratch/**',
      'fixtures/fx-01/native-root/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 严格但务实：显式 any 警告、禁止漂浮 promise 之外的常见疏漏由 tsc 保证
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
