import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * .claude/hooks/tdd-push-gate.sh（PreToolUse / Bash）が、git push の前に
 * CI の tdd-order と同じ確認（check-tdd-order.sh）を手元で流し、通らなければ止めることのテスト
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'tdd-push-gate.sh');
const SCRIPTS = path.join(ROOT, '.github', 'scripts');

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

let repo: string;
let fakeBin: string;
let ghCalled: string;

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: GIT_ENV,
  }).trim();
}

function commit(subject: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(repo, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', subject);
}

/** gh pr view の答えを決める（null なら PR がないものとして失敗させる） */
function fakeGh(pr: { baseRefName: string; labels: string[] } | null): void {
  const body =
    pr === null
      ? 'exit 1'
      : `echo '${JSON.stringify({
          baseRefName: pr.baseRefName,
          labels: pr.labels.map((name) => ({ name })),
        })}'`;
  fs.writeFileSync(
    path.join(fakeBin, 'gh'),
    `#!/bin/sh\ntouch '${ghCalled}'\n${body}\n`,
    { mode: 0o755 },
  );
}

function runHook(command: string): { status: number | null; stderr: string } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd: repo }),
    encoding: 'utf-8',
    env: { ...GIT_ENV, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  return { status: r.status, stderr: r.stderr };
}

const IMPL = 'backend/src/foo/foo.ts';
const PUSH = ['git', 'push'].join(' ');

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-push-gate-'));
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-push-gate-bin-'));
  ghCalled = path.join(fakeBin, 'gh-called');
  git('init', '-q', '-b', 'main');
  // 確認のスクリプトを、リポジトリと同じ場所に置く
  fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
  for (const f of ['check-tdd-order.sh', 'related-tests.mjs']) {
    fs.copyFileSync(
      path.join(SCRIPTS, f),
      path.join(repo, '.github', 'scripts', f),
    );
  }
  commit('chore: 最初のコミット', { [IMPL]: 'export const a = 1;\n' });
  // PR の宛先（origin/release/v9.9.9）を今のコミットにする
  git('update-ref', 'refs/remotes/origin/release/v9.9.9', 'HEAD');
  git('switch', '-q', '-c', 'fix/x');
  fakeGh({ baseRefName: 'release/v9.9.9', labels: [] });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

describe('tdd-push-gate.sh', () => {
  it('TDD の順番が通らないまま push したら、理由を示して止める（終了コード 2）', () => {
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    const r = runHook(PUSH);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('fix: テストなしで直す');
  });

  it('TDD の順番が通れば、push を止めない', () => {
    commit('test: テストを足す', {
      'backend/src/foo/foo.spec.ts':
        "it('a', () => {\n  expect(1).toBe(1);\n});\n",
    });
    commit('fix: 直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(PUSH).status).toBe(0);
  });

  it.each([
    `cd backend && ${PUSH} -u origin fix/x`,
    `git -C . push`,
    `npm test; ${PUSH}`,
  ])('「%s」も push として調べる', (command) => {
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(command).status).toBe(2);
  });

  it.each([
    'git status',
    `git commit -m "${PUSH} する前に直す"`,
    `echo ${PUSH}`,
  ])('push ではないコマンド（%s）は調べない（gh も呼ばない）', (command) => {
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(command).status).toBe(0);
    expect(fs.existsSync(ghCalled)).toBe(false);
  });

  it('SKIP_TDD_CHECK=1 を付けた push は止めない', () => {
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(`SKIP_TDD_CHECK=1 ${PUSH}`).status).toBe(0);
  });

  it('PR に no-tdd のラベルがあれば止めない', () => {
    fakeGh({ baseRefName: 'release/v9.9.9', labels: ['no-tdd'] });
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(PUSH).status).toBe(0);
  });

  it('PR がない（宛先が分からない）ときは止めない', () => {
    fakeGh(null);
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(PUSH).status).toBe(0);
  });

  it('確認のスクリプトがないブランチでは止めない', () => {
    fs.rmSync(path.join(repo, '.github'), { recursive: true });
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    expect(runHook(PUSH).status).toBe(0);
  });
});
