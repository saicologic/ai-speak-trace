import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * テストのファイルで、テストを外す書き方（.skip・.only・x・f の付いた関数）を lint で止めることを確かめる
 * （テストを外して通ったことにするのを、CI の lint で止めるため）
 */
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const ESLINT = path.join(BACKEND_DIR, 'node_modules', '.bin', 'eslint');
// 型の情報を使うルールが tsconfig に含まれるファイルを求めるため、すでにあるテストのファイル名で中身だけ差し替えて調べる
const SPEC_FILE = 'src/common/safe-path.spec.ts';

interface LintMessage {
  line: number;
  ruleId: string | null;
  severity: number;
}

/** コードを lint し、行ごとの error のルール名を返す */
function lintErrorsByLine(code: string): Map<number, string[]> {
  let out: string;
  try {
    out = execFileSync(
      ESLINT,
      [
        '--stdin',
        '--stdin-filename',
        SPEC_FILE,
        '-f',
        'json',
        '--rule',
        '{"prettier/prettier":"off"}',
      ],
      { cwd: BACKEND_DIR, input: code, encoding: 'utf-8' },
    );
  } catch (error) {
    // error があると終了コード 1 で終わるが、結果は stdout に出る
    out = (error as { stdout: string }).stdout;
  }
  const [result] = JSON.parse(out) as { messages: LintMessage[] }[];
  const byLine = new Map<number, string[]>();
  for (const m of result.messages) {
    if (m.severity !== 2) continue;
    byLine.set(m.line, [...(byLine.get(m.line) ?? []), m.ruleId ?? '']);
  }
  return byLine;
}

describe('テストのファイルの lint', () => {
  const lines = [
    "it.skip('a', () => {});",
    "it.only('a', () => {});",
    "test.skip('a', () => {});",
    "test.only('a', () => {});",
    "describe.skip('a', () => {});",
    "describe.only('a', () => {});",
    "xit('a', () => {});",
    "xtest('a', () => {});",
    "xdescribe('a', () => {});",
    "fit('a', () => {});",
    "fdescribe('a', () => {});",
    "it('a', () => {});",
    "describe('a', () => {});",
    "it.todo('a');",
  ];
  let errors: Map<number, string[]>;

  beforeAll(() => {
    errors = lintErrorsByLine(lines.join('\n') + '\n');
  }, 60_000);

  it.each(lines.slice(0, 6).map((code, i) => [code, i + 1]))(
    '%s を止める',
    (_code, line) => {
      expect(errors.get(line)).toContain('no-restricted-properties');
    },
  );

  it.each(lines.slice(6, 11).map((code, i) => [code, i + 7]))(
    '%s を止める',
    (_code, line) => {
      expect(errors.get(line)).toContain('no-restricted-globals');
    },
  );

  it.each(lines.slice(11).map((code, i) => [code, i + 12]))(
    '%s は止めない',
    (_code, line) => {
      expect(errors.get(line)).toBeUndefined();
    },
  );
});
