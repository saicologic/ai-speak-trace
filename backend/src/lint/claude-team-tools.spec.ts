import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * .claude/team（チームで共通に使う Claude Code の managed settings と、サンドボックスの外で動かすスクリプト）の
 * テスト（.claude/team/tests/*.test.sh）を流し、すべて通ることを確かめる
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TESTS = path.join(ROOT, '.claude', 'team', 'tests');

const files = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.sh'))
  .sort();

describe('.claude/team のテスト', () => {
  it('テストのファイルがある', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'block-secrets.test.sh',
        'cr-gate-push.test.sh',
        'cr-review.test.sh',
        'github.test.sh',
        'managed-settings.test.sh',
        'wait-pr-checks.test.sh',
        'watch-pr-checks.test.sh',
      ]),
    );
  });

  it.each(files)('%s', (file) => {
    const result = spawnSync('bash', [path.join(TESTS, file)], {
      encoding: 'utf-8',
      timeout: 120_000,
    });
    // 失敗したときに、どの場面が失敗したかを出す
    const output = `${result.stdout}\n${result.stderr}`;
    expect({ status: result.status, output }).toEqual({
      status: 0,
      output: expect.stringMatching(/pass=\d+ fail=0/),
    });
  });
});
