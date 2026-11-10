#!/bin/bash
# チームで共通に使う Claude Code の managed settings と、サンドボックスの外で動かすスクリプトを、この Mac に入れる
#
# 使い方（ターミナルで自分で実行する。Claude Code には実行させない）:
#   GitHub からこのファイルをダウンロードし、成功したときだけ sudo bash <ファイル> [<SHA>] で実行する
#   （手順は docs/developers/claude-code-sandbox.md。引数なしなら main の今のコミットから入れる。main にまだない版は、
#     レビューしてマージしたコミットの SHA を、ダウンロードの URL と引数の両方に書く）
#
# - このスクリプトも、入れるものも、手元の作業ツリーからは取らない。作業ツリーは Claude Code のサンドボックスの中から
#   書き換えられるため、GitHub（https://github.com/saicologic/ai-speak-trace）でレビューしてマージしたものだけを root の持ち物にする。
#   main（ブランチ保護で PR が必須）か、指定した SHA のコミット（main か release/* の履歴に入っているものだけ）を、
#   root だけが読み書きできる一時フォルダに取り出して、そこから入れる。
#   release/* などは直接 push できるため、ブランチの名前では受け付けない
# - スクリプト → /opt/claude-code-team/bin（root の持ち物。サンドボックスの中からも、ほかのリポジトリからも書き換えられない）
#   TDD の順番の確認に使う CI のスクリプト（.github/scripts）→ /opt/claude-code-team/bin/ci
# - 送ってよいリポジトリの一覧 → /opt/claude-code-team/etc/github-repos
# - 入れたコミット → /opt/claude-code-team/etc/installed-from
# - managed settings → /Library/Application Support/ClaudeCode/managed-settings.json（その Mac のすべてのプロジェクトに効く）
#   入れる前の managed-settings.json があれば、同じフォルダに managed-settings.json.<日時>.bak として残す。
#   はじめて入れる前の managed-settings.json は、managed-settings.json.before-claude-code-team として別に残す（外すときに戻す）
#
# .claude/team・.github/scripts を変える PR をマージしたら、もう一度実行する
set -euo pipefail

REPO_URL=https://github.com/saicologic/ai-speak-trace.git
target=${1:-main}

[ "$(uname -s)" = "Darwin" ] || { echo "macOS で実行してください" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "sudo で実行してください" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です（brew install jq）" >&2; exit 1; }
command -v git >/dev/null || { echo "git が必要です" >&2; exit 1; }
case "$target" in
  main) ref=refs/heads/main ;;
  *)
    [[ "$target" =~ ^[0-9a-f]{40}$ ]] || { echo "main か、コミットの SHA（40 文字）を指定してください: $target" >&2; exit 1; }
    ref=$target
    ;;
esac

# root だけが読み書きできる一時フォルダに取り出す（取り出した中身を、入れる前に書き換えられないように）
work=$(mktemp -d "/private/tmp/claude-code-team-install.XXXXXX")
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
# ユーザー・システムの git の設定を読まず、git のフックを動かさない
git_root() { GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -c core.hooksPath=/dev/null -C "$work/repo" "$@"; }
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git init -q --template= "$work/repo"
if [ "$target" = main ]; then
  git_root fetch --quiet --depth 1 "$REPO_URL" "$ref"
  sha=$(git_root rev-parse "FETCH_HEAD^{commit}")
else
  # GitHub は、どのブランチにも入っていないコミット（PR の途中のものなど）も SHA で取り出せるため、
  # main か release/* の履歴に入っている（レビューしてマージした）コミットかを確かめる
  git_root fetch --quiet "$REPO_URL" "$ref" \
    '+refs/heads/main:refs/remotes/origin/main' '+refs/heads/release/*:refs/remotes/origin/release/*'
  sha=$(git_root rev-parse "$target^{commit}")
  [ "$sha" = "$target" ] || { echo "取り出したコミットが、指定した SHA と違います: $sha" >&2; exit 1; }
  merged=""
  while IFS= read -r b; do
    if git_root merge-base --is-ancestor "$sha" "$b"; then
      merged=$b
      break
    fi
  done < <(git_root for-each-ref --format='%(refname)' refs/remotes/origin)
  [ -n "$merged" ] || { echo "main・release/* に入っていないコミットです（レビューしてマージしたコミットを指定してください）: $sha" >&2; exit 1; }
fi
mkdir "$work/tree"
git_root archive "$sha" .claude/team .github/scripts | tar -x -C "$work/tree"
src="$work/tree/.claude/team"
ci="$work/tree/.github/scripts"

# 壊れた JSON を入れると、Claude Code が起動しなくなるため、先に確かめる
jq empty "$src/managed-settings.json"

prefix=/opt/claude-code-team
managed_dir="/Library/Application Support/ClaudeCode"
install -d -o root -g wheel -m 755 "$prefix" "$prefix/bin" "$prefix/bin/lib" "$prefix/bin/ci" "$prefix/etc"
# 新しいものを先に置き、その後で、前に入れたもので今はないものを消す
# （途中で失敗しても、managed settings が呼ぶスクリプトがなくならないように）
install -o root -g wheel -m 755 "$src"/bin/*.sh "$prefix/bin/"
install -o root -g wheel -m 644 "$src"/bin/lib/* "$prefix/bin/lib/"
install -o root -g wheel -m 644 "$ci/check-tdd-order.sh" "$ci/related-tests.mjs" "$prefix/bin/ci/"
for old in "$prefix"/bin/*.sh "$prefix"/bin/lib/* "$prefix"/bin/ci/*; do
  [ -e "$old" ] || continue
  rel=${old#"$prefix"/bin/}
  case "$rel" in
    ci/check-tdd-order.sh | ci/related-tests.mjs) ;;
    ci/*) rm -f "$old" ;;
    *) [ -e "$src/bin/$rel" ] || rm -f "$old" ;;
  esac
done
install -o root -g wheel -m 644 "$src/etc/github-repos" "$prefix/etc/github-repos"
printf '%s %s\n' "$target" "$sha" >"$prefix/etc/installed-from"
chown root:wheel "$prefix/etc/installed-from"
chmod 644 "$prefix/etc/installed-from"

install -d -o root -g wheel -m 755 "$managed_dir"
current="$managed_dir/managed-settings.json"
before="$managed_dir/managed-settings.json.before-claude-code-team"
if [ -f "$current" ]; then
  # はじめて入れる前の設定（このチームの設定でないもの）は、外すときに戻せるよう、一度だけ別に残す
  if [ ! -e "$before" ] && ! grep -q '/opt/claude-code-team/bin/' "$current"; then
    cp -p "$current" "$before"
  fi
  cp -p "$current" "$current.$(date +%Y%m%d%H%M%S).bak"
fi
install -o root -g wheel -m 644 "$src/managed-settings.json" "$current"

echo "入れました（GitHub の $target: $sha）:"
echo "  $prefix/bin: $(cd "$prefix/bin" && ls ./*.sh | tr '\n' ' ')"
echo "  $managed_dir/managed-settings.json"
echo "Claude Code を開いている場合は、/status で managed settings が読まれていることを確かめてください"
