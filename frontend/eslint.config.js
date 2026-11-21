import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // テストを外して通ったことにしない（外すときは、理由を書いて eslint-disable する）
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['it', 'test', 'describe'].flatMap((object) =>
          ['skip', 'only'].map((property) => ({ object, property, message: 'テストを外さないでください' })),
        ),
      ],
    },
  },
  {
    // ブラウザのテスト（Playwright）でも、テストを外して通ったことにしない
    // （test.skip・test.only・test.fixme・test.describe.skip など。外すときは、理由を書いて eslint-disable する）
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression > MemberExpression.callee > Identifier.property[name=/^(skip|only|fixme)$/]",
          message: 'テストを外さないでください',
        },
      ],
    },
  },
  {
    // sidecar の API はトークンを付ける apiFetch で呼ぶ（fetch を直接使うと、トークンなしで断られる）
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'sidecar の API は api/client.ts の apiFetch で呼んでください' },
      ],
    },
  },
])
