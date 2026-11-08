// @vitest-environment node
import path from 'node:path'
import { ESLint } from 'eslint'

/**
 * テストのファイルで、テストを外す書き方（.skip・.only）を lint で止めることを確かめる
 * （テストを外して通ったことにするのを、CI の lint で止めるため）
 */
const FRONTEND_DIR = path.resolve(__dirname, '..', '..')

const lines = [
  "it.skip('a', () => {})",
  "it.only('a', () => {})",
  "test.skip('a', () => {})",
  "test.only('a', () => {})",
  "describe.skip('a', () => {})",
  "describe.only('a', () => {})",
  "it('a', () => {})",
  "describe('a', () => {})",
  "it.todo('a')",
]

describe('テストのファイルの lint', () => {
  let errors: Map<number, string[]>

  beforeAll(async () => {
    const eslint = new ESLint({ cwd: FRONTEND_DIR })
    const [result] = await eslint.lintText(lines.join('\n') + '\n', {
      filePath: path.join(FRONTEND_DIR, 'src/utils/sample.test.ts'),
    })
    errors = new Map()
    for (const m of result.messages) {
      if (m.severity !== 2) continue
      errors.set(m.line, [...(errors.get(m.line) ?? []), m.ruleId ?? ''])
    }
  }, 60_000)

  it.each(lines.slice(0, 6).map((code, i) => [code, i + 1] as const))('%s を止める', (_code, line) => {
    expect(errors.get(line)).toContain('no-restricted-properties')
  })

  it.each(lines.slice(6).map((code, i) => [code, i + 7] as const))('%s は止めない', (_code, line) => {
    expect(errors.get(line)).toBeUndefined()
  })
})
