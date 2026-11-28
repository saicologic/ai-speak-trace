import * as fs from 'fs';
import * as path from 'path';

/**
 * .claude/team/install.sh が、.claude/team/bin のスクリプトを /opt/claude-code-team/bin に入れる書き方のテスト。
 * install.sh は sudo で動くインストーラーのため、動かさずに、書き方だけを読んで確かめる
 * （新しい .claude/team/bin のスクリプトが、install.sh を変えなくても入ることを、レビューから確かめられるようにする）
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TEAM = path.join(ROOT, '.claude', 'team');
const INSTALL = path.join(TEAM, 'install.sh');

/** コメントと空の行を除いた、install.sh の行 */
const lines = fs
  .readFileSync(INSTALL, 'utf-8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** 書き方が一致する行の位置（ないときは -1） */
function indexOf(pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line));
}

/** 正規表現の特別な文字をそのまま比べるための書き換え */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** install -o root -g wheel -m <mode> <src> <dest> の形の行 */
function installLine(mode: string, src: string, dest: string): RegExp {
  return new RegExp(
    `^install -o root -g wheel -m ${mode} ${literal(src)} ${literal(dest)}$`,
  );
}

const BIN_SH = installLine('755', '"$src"/bin/*.sh', '"$prefix/bin/"');
const BIN_LIB = installLine('644', '"$src"/bin/lib/*', '"$prefix/bin/lib/"');

describe('install.sh が .claude/team/bin を入れる書き方', () => {
  it('インストール先は /opt/claude-code-team', () => {
    expect(lines).toContain('prefix=/opt/claude-code-team');
  });

  it('取り出した .claude/team を $src にする', () => {
    expect(lines).toContain('src="$work/tree/.claude/team"');
  });

  it('.claude/team/bin/*.sh を、root の持ち物・755 で /opt/claude-code-team/bin/ に入れる', () => {
    expect(indexOf(BIN_SH)).toBeGreaterThanOrEqual(0);
  });

  it('.claude/team/bin/lib/* を、root の持ち物・644 で /opt/claude-code-team/bin/lib/ に入れる', () => {
    expect(indexOf(BIN_LIB)).toBeGreaterThanOrEqual(0);
  });

  it('失敗したらそこで止まる（set -e。消すのを入れた後にする意味がなくなるため）', () => {
    expect(lines).toContain('set -euo pipefail');
  });

  it('インストール先の bin と bin/lib を、root の持ち物・755 で作る', () => {
    expect(
      indexOf(
        new RegExp(
          `^install -d -o root -g wheel -m 755 ${literal('"$prefix"')} .*${literal('"$prefix/bin" "$prefix/bin/lib"')}`,
        ),
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  describe('取り出した方にないスクリプトを、インストール先から消す', () => {
    const loop = indexOf(
      /^for old in "\$prefix"\/bin\/\*\.sh "\$prefix"\/bin\/lib\/\* /,
    );
    const done = lines.indexOf('done', loop);

    it('インストール先の bin/*.sh と bin/lib/* を順に調べる', () => {
      expect(loop).toBeGreaterThanOrEqual(0);
    });

    it('ループの中は、取り出した .claude/team/bin に同じ名前がなければ消すだけ', () => {
      // 途中に別の腕・continue を足して、消さないようにする書き換えを止める
      expect(lines.slice(loop + 1, done)).toEqual([
        '[ -e "$old" ] || continue',
        'rel=${old#"$prefix"/bin/}',
        'case "$rel" in',
        'ci/check-tdd-order.sh | ci/related-tests.mjs) ;;',
        'ci/*) rm -f "$old" ;;',
        '*) [ -e "$src/bin/$rel" ] || rm -f "$old" ;;',
        'esac',
      ]);
    });

    it('消すのは、新しいものを入れた後', () => {
      expect(loop).toBeGreaterThan(indexOf(BIN_SH));
      expect(loop).toBeGreaterThan(indexOf(BIN_LIB));
    });
  });
});

describe('.claude/team/bin のファイルが、install.sh の書き方で入る', () => {
  const bin = path.join(TEAM, 'bin');
  /** . で始まる名前（Finder の .DS_Store など。git archive で取り出す中身には入らない）を除いた中身 */
  const entries = (dir: string): fs.Dirent[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'));

  it('bin の直下は、.sh のファイルと lib のフォルダだけ（*.sh から漏れるものがない）', () => {
    const outside = entries(bin)
      .filter((e) =>
        e.isDirectory() ? e.name !== 'lib' : !e.name.endsWith('.sh'),
      )
      .map((e) => e.name);
    expect(outside).toEqual([]);
  });

  it('bin/lib にフォルダがない（install に lib/* のフォルダを渡すと失敗する）', () => {
    const dirs = entries(path.join(bin, 'lib'))
      .filter((e) => !e.isFile())
      .map((e) => e.name);
    expect(dirs).toEqual([]);
  });

  // 合うファイルがないと、glob がそのまま install に渡り、set -e でインストールが止まる
  it('bin に .sh のファイルが1つ以上ある', () => {
    expect(
      entries(bin).filter((e) => e.isFile() && e.name.endsWith('.sh')).length,
    ).toBeGreaterThan(0);
  });

  it('bin/lib にファイルが1つ以上ある', () => {
    expect(
      entries(path.join(bin, 'lib')).filter((e) => e.isFile()).length,
    ).toBeGreaterThan(0);
  });
});
