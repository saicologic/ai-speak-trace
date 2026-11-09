import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * .claude/hooks/cr-limit-gate.sh（PreToolUse / Bash）が、CodeRabbit のレビュー枠が切れている間、
 * レビューを動かすコマンド（git push・gh pr create・gh pr ready・@coderabbitai を書く gh pr comment・cr-review.sh）
 * だけを止め、引用符・heredoc・コメントの中の文字では止めないことのテスト
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'cr-limit-gate.sh');
const TARGETS = path.join(ROOT, '.claude', 'hooks', 'cr-limit-targets.mjs');

const BASH = execFileSync('sh', ['-c', 'command -v bash'], {
  encoding: 'utf-8',
}).trim();

// 文字列に書くと、push を止める hook が反応することがあるため、組み立てて作る
const PUSH = ['git', 'push'].join(' ');
const CR_REVIEW = '~/.claude/hooks/cr-review.sh';

let repo: string;
// .coderabbit.yaml のないフォルダ（git のリポジトリでもない）
let plain: string;
let home: string;
let fakeBin: string;

/**
 * GitHub の CodeRabbit の枠切れのコメントを返す gh を置く（枠が切れていないときは、コメントなし）。
 * リポジトリの名前は、gh を実行したフォルダの名前にする。limited にフォルダを渡すと、そのリポジトリの枠だけが切れている
 */
function fakeGh(limited: boolean | string): void {
  const comments = limited
    ? [
        {
          user: { login: 'coderabbitai[bot]' },
          updated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          body: 'Next included review available in 30 minutes.',
        },
      ]
    : [];
  fs.writeFileSync(
    path.join(fakeBin, 'gh'),
    [
      '#!/bin/sh',
      'case "$1 $2" in',
      '  "repo view") echo "owner/$(basename "$PWD")" ;;',
      typeof limited === 'string'
        ? `  "api "*) case "$*" in *"repos/owner/${path.basename(limited)}/"*) echo '${JSON.stringify(comments)}' ;; *) echo '[]' ;; esac ;;`
        : `  "api "*) echo '${JSON.stringify(comments)}' ;;`,
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** 手元の CodeRabbit CLI の枠が戻る時刻を書く */
function cliLimited(limited: boolean): void {
  const until = limited ? Math.floor(Date.now() / 1000) + 1800 : 0;
  fs.writeFileSync(
    path.join(home, '.claude', 'state', 'coderabbit-cli-limit-until'),
    String(until),
  );
}

/** hook を流し、止めたかを返す */
function blocks(command: string, cwd = repo): boolean {
  const r = spawnSync(BASH, [HOOK], {
    cwd: os.tmpdir(),
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  expect(r.status).toBe(0);
  return r.stdout.includes('"permissionDecision": "deny"');
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-'));
  plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-plain-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-home-'));
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-bin-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.coderabbit.yaml'), '');
  // cd sub の先（相対パスは、入力の cwd から見る）
  fs.mkdirSync(path.join(repo, 'sub'));
  fs.mkdirSync(path.join(home, '.claude', 'state'), { recursive: true });
  // 通知を出さない
  fs.writeFileSync(path.join(fakeBin, 'osascript'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  fakeGh(true);
  cliLimited(true);
});

afterEach(() => {
  for (const d of [repo, plain, home, fakeBin]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('枠が切れているとき、レビューを動かすコマンドを止める', () => {
  it.each([
    [PUSH],
    [`${PUSH} origin fix/a`],
    [`cd sub && ${PUSH}`],
    [`git -C . ${PUSH.slice(4)}`],
    [`FOO=1 ${PUSH}`],
    [`{ ${PUSH}; }`],
    [`if true; then ${PUSH}; fi`],
    [`(${PUSH})`],
    [`! ${PUSH}`],
    ['gh pr create --draft --title t --body b'],
    ['gh pr ready 12'],
    ['gh pr comment 12 --body "@coderabbitai review"'],
    [CR_REVIEW],
    [`${CR_REVIEW} --base-branch main`],
    ['bash $HOME/.claude/hooks/cr-review.sh'],
    ['bash -x ${HOME}/.claude/hooks/cr-review.sh'],
    ['sh $HOME/.claude/hooks/cr-review.sh'],
    ['bash -o pipefail $HOME/.claude/hooks/cr-review.sh'],
    [`bash -c '${PUSH}'`],
    ['sh -c "gh pr create --draft"'],
    [`bash -lc 'cd sub && ${PUSH}'`],
    ['PR_URL=$(gh pr create --draft --title t --body b)'],
    [`echo "$(${PUSH})"`],
    ['echo `gh pr create --draft`'],
    ['$HOME/.claude/hooks/cr-review.sh'],
    ['/Users/x/.claude/hooks/cr-review.sh'],
    [`${PUSH} -d origin a && ${PUSH}`],
    [`${PUSH} origin :fix/a fix/b`],
    [`${PUSH} --tags origin fix/a`],
    [`${PUSH} -o ci.skip origin fix/a >/dev/null 2>&1`],
    // 相対パスでないパスを決められないときは、入力の cwd のリポジトリとして見る
    [`cd "$(git rev-parse --show-toplevel)" && ${PUSH}`],
    [`git -C "$REPO" ${PUSH.slice(4)}`],
    [`SKIP_CR_LIMIT=1 git status && ${PUSH}`],
  ])('%s', (command) => {
    expect(blocks(command)).toBe(true);
  });
});

describe('枠が切れていても、レビューを動かさないコマンドは止めない', () => {
  it.each([
    ['git status'],
    [`git commit -m "メモ: ${PUSH} する"`],
    [`git commit -m "a; ${PUSH}"`],
    [`echo 'a && gh pr create'`],
    [`python3 -c "print('x | ${PUSH}')"`],
    [`cat <<'EOF' > note.md\n${PUSH}\ngh pr create\nEOF`],
    [`git log --oneline -1 # ${PUSH}`],
    [`grep -n push ${CR_REVIEW}`],
    [`${PUSH} --delete origin fix/a`],
    [`${PUSH} origin :fix/a`],
    [`${PUSH} --tags`],
    ["bash -c 'git status'"],
    [`bash -c 'echo "${PUSH}"'`],
    [`git commit -m "$(cat <<'EOF'\nメモ: ${PUSH}\ngh pr create\nEOF\n)"`],
    ["echo '$(gh pr create --draft)'"],
    [`${PUSH} -d origin fix/a`],
    [`${PUSH} --tags origin`],
    [`${PUSH} origin :fix/a >/dev/null 2>&1`],
    [`${PUSH} --push-option ci.skip origin :fix/a`],
    [
      'gh pr comment 12 --body "LGTM" && git commit -m "@coderabbitai の指摘を直す"',
    ],
    ['gh pr ready 12 --undo'],
    ['gh pr comment 12 --body "ありがとうございます"'],
    [`${CR_REVIEW} --accept`],
    [`${CR_REVIEW} --base`],
    [`SKIP_CR_LIMIT=1 ${PUSH}`],
    ['SKIP_CR_LIMIT=1 gh pr create --draft'],
  ])('%s', (command) => {
    expect(blocks(command)).toBe(false);
  });
});

describe('枠が切れていないときは止めない', () => {
  beforeEach(() => {
    fakeGh(false);
    cliLimited(false);
  });

  it.each([[PUSH], ['gh pr create --draft'], [CR_REVIEW]])('%s', (command) => {
    expect(blocks(command)).toBe(false);
  });
});

describe('gh pr comment の本文をファイル・heredoc から読むとき', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(repo, 'sub', 'cr.md'), '@coderabbitai review\n');
    fs.writeFileSync(
      path.join(repo, 'sub', 'thanks.md'),
      'ありがとうございます\n',
    );
  });

  it.each([
    ['cd sub && gh pr comment 12 -F cr.md', true],
    ['cd sub && gh pr comment 12 --body-file cr.md', true],
    ['gh pr comment 12 --body-file=sub/cr.md', true],
    ["gh pr comment 12 --body-file - <<'EOF'\n@coderabbitai review\nEOF", true],
    ['echo "@coderabbitai review" | gh pr comment 12 -F -', true],
    ["cat <<'EOF' | gh pr comment 12 -F -\n@coderabbitai review\nEOF", true],
    ['gh pr comment 12 -F - < sub/cr.md', true],
    ['cd sub && gh pr comment 12 -F thanks.md', false],
    ['gh pr comment 12 -F sub/none.md', false],
  ])('%s', (command, expected) => {
    expect(blocks(command)).toBe(expected);
  });
});

describe('リポジトリは、コマンドの中の cd・git -C で決める', () => {
  it('.coderabbit.yaml のないフォルダでは止めない', () => {
    expect(blocks(PUSH, plain)).toBe(false);
    expect(blocks('gh pr create --draft', plain)).toBe(false);
    expect(blocks(CR_REVIEW, plain)).toBe(false);
  });

  it('cd <repo> の後の push は止める', () => {
    expect(blocks(`cd ${repo} && ${PUSH}`, plain)).toBe(true);
  });

  it('git -C <repo> の push は止める', () => {
    expect(blocks(`git -C ${repo} ${PUSH.slice(4)}`, plain)).toBe(true);
  });

  it('cd <.coderabbit.yaml のないフォルダ> の後の push は止めない', () => {
    expect(blocks(`cd ${plain} && ${PUSH}`)).toBe(false);
  });

  it('サブシェルの中の cd は、外の push に効かない', () => {
    expect(blocks(`(cd ${plain} && ls); ${PUSH}`)).toBe(true);
  });

  it('ほかのリポジトリへの push では、こちらのリポジトリの GitHub の枠で止めない', () => {
    cliLimited(false);
    expect(blocks(`git status && git -C ${plain} ${PUSH.slice(4)}`)).toBe(
      false,
    );
  });

  it('先の部分が .coderabbit.yaml のないフォルダでも、後の部分のリポジトリで止める', () => {
    expect(
      blocks(`git -C ${plain} status; git -C ${repo} ${PUSH.slice(4)}`, plain),
    ).toBe(true);
  });
});

describe('GitHub と手元の CLI の枠は、分けて見る', () => {
  let other: string;
  beforeEach(() => {
    other = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-other-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
    fs.writeFileSync(path.join(other, '.coderabbit.yaml'), '');
    cliLimited(false);
  });
  afterEach(() => {
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('GitHub の枠は、cr-review.sh を動かすリポジトリではなく、push 先のリポジトリで調べる', () => {
    fakeGh(other);
    expect(blocks(`${CR_REVIEW}; git -C ${other} ${PUSH.slice(4)}`)).toBe(true);
    fakeGh(repo);
    expect(blocks(`${CR_REVIEW}; git -C ${other} ${PUSH.slice(4)}`)).toBe(
      false,
    );
  });

  it('GitHub の枠だけが切れているとき、push は止め、cr-review.sh は止めない', () => {
    cliLimited(false);
    expect(blocks(PUSH)).toBe(true);
    expect(blocks(CR_REVIEW)).toBe(false);
  });

  it('手元の CLI の枠だけが切れているとき、cr-review.sh は止め、push は止めない', () => {
    fakeGh(false);
    cliLimited(true);
    expect(blocks(CR_REVIEW)).toBe(true);
    expect(blocks(PUSH)).toBe(false);
  });
});

describe('cr-limit-targets.mjs の出力', () => {
  function targets(command: string, cwd = repo): unknown[] {
    const r = spawnSync('node', [TARGETS, cwd], {
      input: command,
      encoding: 'utf-8',
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    return r.stdout
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as unknown);
  }

  it('部分ごとに、確かめる枠とフォルダを出す', () => {
    expect(
      targets(`cd sub && ${PUSH}; ${CR_REVIEW}; cd ~ && gh pr create`),
    ).toEqual([
      { check: 'github', dir: path.join(repo, 'sub') },
      { check: 'cli', dir: path.join(repo, 'sub') },
      { check: 'github', dir: home },
    ]);
  });

  it('cd だけなら HOME、cd -- <dir> なら <dir> に移る', () => {
    expect(targets(`cd && ${PUSH}; cd -- ${repo} && ${PUSH}`)).toEqual([
      { check: 'github', dir: home },
      { check: 'github', dir: repo },
    ]);
  });

  it('git -C を重ねたときは、順に見る', () => {
    expect(targets(`git -C ${repo} -C sub ${PUSH.slice(4)}`, plain)).toEqual([
      { check: 'github', dir: path.join(repo, 'sub') },
    ]);
  });

  it('cd した先の ./cr-review.sh も、手元のレビューとして出す', () => {
    expect(targets('cd ~/.claude/hooks && ./cr-review.sh')).toEqual([
      { check: 'cli', dir: path.join(home, '.claude', 'hooks') },
    ]);
  });

  it('レビューを動かす部分がなければ、何も出さない', () => {
    expect(targets(`git commit -m "${PUSH}"`)).toEqual([]);
  });
});
