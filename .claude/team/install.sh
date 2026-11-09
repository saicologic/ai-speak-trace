#!/bin/bash
# チームで共通に使う Claude Code の managed settings と、サンドボックスの外で動かすスクリプトを、この Mac に入れる
#
# 使い方（リポジトリのフォルダで）: sudo .claude/team/install.sh
#
# - スクリプト → /opt/claude-code-team/bin（root の持ち物。サンドボックスの中からも、ほかのリポジトリからも書き換えられない）
#   TDD の順番の確認に使う CI のスクリプト（.github/scripts）→ /opt/claude-code-team/bin/ci
# - 送ってよいリポジトリの一覧 → /opt/claude-code-team/etc/github-repos
# - managed settings → /Library/Application Support/ClaudeCode/managed-settings.json（その Mac のすべてのプロジェクトに効く）
#
# 入れる前の managed-settings.json があれば、同じフォルダに managed-settings.json.<日時>.bak として残す。
# リポジトリの .claude/team を変える PR をマージしたら、もう一度実行する。
set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "macOS で実行してください" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "sudo で実行してください: sudo $0" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です（brew install jq）" >&2; exit 1; }

src=$(cd "$(dirname "$0")" && pwd -P)
prefix=/opt/claude-code-team
managed_dir="/Library/Application Support/ClaudeCode"

# 壊れた JSON を入れると、Claude Code が起動しなくなるため、先に確かめる
jq empty "$src/managed-settings.json"

install -d -o root -g wheel -m 755 "$prefix" "$prefix/bin" "$prefix/bin/lib" "$prefix/bin/ci" "$prefix/etc"
# 前に入れたスクリプトで、今はないものを残さない
rm -f "$prefix"/bin/*.sh "$prefix"/bin/lib/* "$prefix"/bin/ci/*
install -o root -g wheel -m 755 "$src"/bin/*.sh "$prefix/bin/"
install -o root -g wheel -m 644 "$src"/bin/lib/* "$prefix/bin/lib/"
# TDD の順番の確認（tdd-push-gate.sh）が動かす CI のスクリプト。作業ツリーのものはサンドボックスの中から書き換えられるため、
# レビューを通ったこの時点のものを入れておく
install -o root -g wheel -m 644 "$src/../../.github/scripts/check-tdd-order.sh" "$src/../../.github/scripts/related-tests.mjs" "$prefix/bin/ci/"
install -o root -g wheel -m 644 "$src/etc/github-repos" "$prefix/etc/github-repos"

install -d -o root -g wheel -m 755 "$managed_dir"
if [ -f "$managed_dir/managed-settings.json" ]; then
  cp -p "$managed_dir/managed-settings.json" "$managed_dir/managed-settings.json.$(date +%Y%m%d%H%M%S).bak"
fi
install -o root -g wheel -m 644 "$src/managed-settings.json" "$managed_dir/managed-settings.json"

echo "入れました:"
echo "  $prefix/bin: $(cd "$prefix/bin" && ls ./*.sh | tr '\n' ' ')"
echo "  $managed_dir/managed-settings.json"
echo "Claude Code を開いている場合は、/status で managed settings が読まれていることを確かめてください"
