import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * .github/scripts/check-tdd-order.sh が、PR のコミットの並びから
 * 「実装より先にテストを変えたか」「実装のコミットでテストの expect を減らしていないか」を確かめることのテスト
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'check-tdd-order.sh',
);

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

/** ファイルを書いて（null なら消して）コミットする */
function commit(subject: string, files: Record<string, string | null>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(repo, file);
    if (content === null) {
      fs.rmSync(full);
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', subject);
}

function check(base: string): { status: number | null; output: string } {
  const r = spawnSync('bash', [SCRIPT, base, 'HEAD'], {
    cwd: repo,
    encoding: 'utf-8',
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

const SPEC = 'backend/src/foo/foo.spec.ts';
const IMPL = 'backend/src/foo/foo.ts';

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-order-'));
  git('init', '-q', '-b', 'main');
  commit('chore: 最初のコミット', {
    [SPEC]: "it('a', () => {\n  expect(1).toBe(1);\n});\n",
    [IMPL]: 'export const a = 1;\n',
  });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('check-tdd-order.sh', () => {
  it('テストのコミットの後に実装のコミットがあれば通す', () => {
    const base = git('rev-parse', 'HEAD');
    commit('test: b のテストを足す', {
      [SPEC]:
        "it('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n",
    });
    commit('fix: b を足す', { [IMPL]: 'export const a = 2;\n' });
    expect(check(base).status).toBe(0);
  });

  it('テストを変えずに実装だけ変えたコミットは止めて、そのコミットを示す', () => {
    const base = git('rev-parse', 'HEAD');
    commit('fix: テストなしで直す', { [IMPL]: 'export const a = 2;\n' });
    const r = check(base);
    expect(r.status).toBe(1);
    expect(r.output).toContain('fix: テストなしで直す');
    expect(r.output).toContain(IMPL);
  });

  it('テストより先に実装をコミットしたら止める', () => {
    const base = git('rev-parse', 'HEAD');
    commit('fix: 先に直す', { [IMPL]: 'export const a = 2;\n' });
    commit('test: 後からテストを足す', {
      [SPEC]:
        "it('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n",
    });
    expect(check(base).status).toBe(1);
  });

  it('同じコミットでテストと実装を変えたら通す', () => {
    const base = git('rev-parse', 'HEAD');
    commit('fix: テストと一緒に直す', {
      [SPEC]:
        "it('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n",
      [IMPL]: 'export const a = 2;\n',
    });
    expect(check(base).status).toBe(0);
  });

  it.each(['refactor: 名前を変える', 'style: 書式をそろえる'])(
    '動きを変えない「%s」のコミットは、テストがなくても通す',
    (subject) => {
      const base = git('rev-parse', 'HEAD');
      commit(subject, { [IMPL]: 'export const a  =  1;\n' });
      expect(check(base).status).toBe(0);
    },
  );

  it.each([
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
    'docs/users/usage.md',
    'backend/package.json',
    '.github/workflows/test.yml',
  ])('実装ではないファイル（%s）だけのコミットは通す', (file) => {
    const base = git('rev-parse', 'HEAD');
    commit('fix: 設定を変える', { [file]: 'x\n' });
    expect(check(base).status).toBe(0);
  });

  it.each([
    ['frontend/src/api/client.ts', 'frontend/src/api/client.test.ts'],
    [
      'frontend/src/components/Foo.tsx',
      'frontend/src/components/__tests__/Foo.test.tsx',
    ],
    ['backend/scripts/mcp-sandbox.sh', 'backend/src/mcp/mcp-sandbox.spec.ts'],
  ])(
    '%s は実装として扱い、テスト（%s）が先なら通し、なければ止める',
    (impl, spec) => {
      const base = git('rev-parse', 'HEAD');
      commit('fix: テストなしで直す', { [impl]: 'x\n' });
      expect(check(base).status).toBe(1);

      git('reset', '-q', '--hard', base);
      commit('test: テストを足す', { [spec]: "it('a', () => {});\n" });
      commit('fix: 直す', { [impl]: 'x\n' });
      expect(check(base).status).toBe(0);
    },
  );

  it('ほかのブランチからマージしたコミットは調べない', () => {
    const base = git('rev-parse', 'HEAD');
    git('switch', '-q', '-c', 'other');
    commit('fix: ほかのブランチでテストなしで直す', {
      [IMPL]: 'export const a = 2;\n',
    });
    git('switch', '-q', 'main');
    commit('docs: 説明を足す', { 'README.md': 'x\n' });
    git('merge', '-q', '--no-edit', 'other');
    expect(check(base).status).toBe(0);
  });

  it('実装のコミットでテストの expect を減らしたら止める', () => {
    const base = git('rev-parse', 'HEAD');
    commit('test: b のテストを足す', {
      [SPEC]:
        "it('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n",
    });
    commit('fix: b を足し、通らない expect を消す', {
      [SPEC]: "it('a', () => {\n  expect(1).toBe(1);\n});\n",
      [IMPL]: 'export const a = 2;\n',
    });
    const r = check(base);
    expect(r.status).toBe(1);
    expect(r.output).toContain('fix: b を足し、通らない expect を消す');
    expect(r.output).toContain('expect');
  });

  it('refactor のコミットでも、テストの expect を減らしたら止める', () => {
    const base = git('rev-parse', 'HEAD');
    commit('refactor: テストを消す', {
      [SPEC]: "it('a', () => {});\n",
    });
    expect(check(base).status).toBe(1);
  });

  it('テストのファイルを消したら止める', () => {
    const base = git('rev-parse', 'HEAD');
    commit('fix: テストを消す', { [SPEC]: null });
    expect(check(base).status).toBe(1);
  });

  it('expect の行を書き換えただけ（数が同じ）なら通す', () => {
    const base = git('rev-parse', 'HEAD');
    commit('refactor: expect の書き方を変える', {
      [SPEC]: "it('a', () => {\n  expect(1).toEqual(1);\n});\n",
    });
    expect(check(base).status).toBe(0);
  });

  it('test のコミットでは、expect を減らしても通す（テストの書き直しのため）', () => {
    const base = git('rev-parse', 'HEAD');
    commit('test: テストを書き直す', { [SPEC]: "it('a', () => {});\n" });
    expect(check(base).status).toBe(0);
  });
});
