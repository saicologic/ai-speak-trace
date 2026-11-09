// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      // 残余（...rest）で取り除くためだけのプロパティは、使わなくてよい
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    // expect(mock.method).toHaveBeenCalled() のように、モックのメソッドを this なしで渡すのはテストの書き方のため
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      // テストを外して通ったことにしない（外すときは、理由を書いて eslint-disable する）
      'no-restricted-properties': [
        'error',
        ...['it', 'test', 'describe'].flatMap((object) =>
          ['skip', 'only'].map((property) => ({
            object,
            property,
            message: 'テストを外さないでください',
          })),
        ),
      ],
      'no-restricted-globals': [
        'error',
        ...['xit', 'xtest', 'xdescribe', 'fit', 'fdescribe'].map((name) => ({
          name,
          message: 'テストを外さないでください',
        })),
      ],
    },
  },
);
