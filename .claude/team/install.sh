#!/bin/bash
# チームで共通に使う Claude Code の managed settings と、サンドボックスの外で動かすスクリプトを、この Mac に入れる
#
# 使い方（ターミナルで自分で実行する。Claude Code には実行させない）:
#   curl -fsSL https://raw.githubusercontent.com/saicologic/ai-speak-trace/main/.claude/team/install.sh | sudo bash -s -- [<ブランチ>]
#   （<ブランチ> を省略すると main。main にまだない版を入れるときは、URL の main とブランチの両方を変える）
#
# - このスクリプトも、入れるものも、手元の作業ツリーからは取らない。作業ツリーは Claude Code のサンドボックスの中から
#   書き換えられるため、GitHub（https://github.com/saicologic/ai-speak-trace）でレビューしてマージしたものだけを root の持ち物にする。
#   <ブランチ> の今のコミットを、root だけが読み書きできる一時フォルダに clone して、そこから入れる
# - スクリプト → /opt/claude-code-team/bin（root の持ち物。サンドボックスの中からも、ほかのリポジトリからも書き換えられない）
#   TDD の順番の確認に使う CI のスクリプト（.github/scripts）→ /opt/claude-code-team/bin/ci
# - 送ってよいリポジトリの一覧 → /opt/claude-code-team/etc/github-repos
# - 入れたコミット → /opt/claude-code-team/etc/installed-from
# - managed settings → /Library/Application Support/ClaudeCode/managed-settings.json（その Mac のすべてのプロジェクトに効く）
#   入れる前の managed-settings.json があれば、同じフォルダに managed-settings.json.<日時>.bak として残す
#
# .claude/team・.github/scripts を変える PR をマージしたら、もう一度実行する
set -euo pipefail

REPO_URL=https://github.com/saicologic/ai-speak-trace.git
branch=${1:-main}

[ "$(uname -s)" = "Darwin" ] || { echo "macOS で実行してください" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "sudo で実行してください" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です（brew install jq）" >&2; exit 1; }
command -v git >/dev/null || { echo "git が必要です" >&2; exit 1; }
if [[ "$branch" == -* ]] || ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  echo "ブランチの名前が正しくありません: $branch" >&2
  exit 1
fi

# root だけが読み書きできる一時フォルダに clone する（clone した中身を、入れる前に書き換えられないように）
work=$(mktemp -d "/private/tmp/claude-code-team-install.XXXXXX")
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
# ユーザー・システムの git の設定を読まず、git のフックを動かさない
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  git -c core.hooksPath=/dev/null clone --quiet --depth 1 --single-branch --branch "$branch" "$REPO_URL" "$work/repo"
sha=$(git -C "$work/repo" rev-parse HEAD)
src="$work/repo/.claude/team"
ci="$work/repo/.github/scripts"

# 壊れた JSON を入れると、Claude Code が起動しなくなるため、先に確かめる
jq empty "$src/managed-settings.json"

prefix=/opt/claude-code-team
managed_dir="/Library/Application Support/ClaudeCode"
install -d -o root -g wheel -m 755 "$prefix" "$prefix/bin" "$prefix/bin/lib" "$prefix/bin/ci" "$prefix/etc"
# 前に入れたスクリプトで、今はないものを残さない
rm -f "$prefix"/bin/*.sh "$prefix"/bin/lib/* "$prefix"/bin/ci/*
install -o root -g wheel -m 755 "$src"/bin/*.sh "$prefix/bin/"
install -o root -g wheel -m 644 "$src"/bin/lib/* "$prefix/bin/lib/"
install -o root -g wheel -m 644 "$ci/check-tdd-order.sh" "$ci/related-tests.mjs" "$prefix/bin/ci/"
install -o root -g wheel -m 644 "$src/etc/github-repos" "$prefix/etc/github-repos"
printf '%s %s\n' "$branch" "$sha" >"$prefix/etc/installed-from"
chown root:wheel "$prefix/etc/installed-from"
chmod 644 "$prefix/etc/installed-from"

install -d -o root -g wheel -m 755 "$managed_dir"
if [ -f "$managed_dir/managed-settings.json" ]; then
  cp -p "$managed_dir/managed-settings.json" "$managed_dir/managed-settings.json.$(date +%Y%m%d%H%M%S).bak"
fi
install -o root -g wheel -m 644 "$src/managed-settings.json" "$managed_dir/managed-settings.json"

echo "入れました（GitHub の $branch: $sha）:"
echo "  $prefix/bin: $(cd "$prefix/bin" && ls ./*.sh | tr '\n' ' ')"
echo "  $managed_dir/managed-settings.json"
echo "Claude Code を開いている場合は、/status で managed settings が読まれていることを確かめてください"
