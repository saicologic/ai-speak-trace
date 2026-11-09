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

const BASH = execFileSync('sh', ['-c', 'command -v bash'], {
  encoding: 'utf-8',
}).trim();

// 文字列に書くと、push を止める hook が反応することがあるため、組み立てて作る
const PUSH = ['git', 'push'].join(' ');
const CR_REVIEW = '~/.claude/hooks/cr-review.sh';

let repo: string;
let home: string;
let fakeBin: string;

/** GitHub の CodeRabbit の枠切れのコメントを返す gh を置く（枠が切れていないときは、コメントなし） */
function fakeGh(limited: boolean): void {
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
      '  "repo view") echo owner/repo ;;',
      `  "api "*) echo '${JSON.stringify(comments)}' ;;`,
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
function blocks(command: string): boolean {
  const r = spawnSync(BASH, [HOOK], {
    cwd: os.tmpdir(),
    input: JSON.stringify({ tool_input: { command }, cwd: repo }),
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  expect(r.status).toBe(0);
  return r.stdout.includes('"permissionDecision": "deny"');
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-limit-gate-'));
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
  for (const d of [repo, home, fakeBin]) {
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
