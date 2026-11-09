#!/bin/bash
# チームで共通に使う Claude Code の managed settings と、サンドボックスの外で動かすスクリプトを、この Mac に入れる
#
# 使い方（リポジトリのフォルダで）: sudo .claude/team/install.sh [<ブランチ>]（省略すると main）
#
# - 作業ツリーのファイルではなく、GitHub（https://github.com/saicologic/ai-speak-trace）の <ブランチ> の今のコミットから入れる。
#   作業ツリーは Claude Code のサンドボックスの中から書き換えられるため、レビューしてマージしたものだけを root の持ち物にする。
#   コミットは GitHub に問い合わせたもの（git ls-remote）で決め、中身は git がそのコミットの番号で確かめる
#   （手元の origin・refs は、サンドボックスの中から書き換えられるため使わない）
# - スクリプト → /opt/claude-code-team/bin（root の持ち物。サンドボックスの中からも、ほかのリポジトリからも書き換えられない）
#   TDD の順番の確認に使う CI のスクリプト（.github/scripts）→ /opt/claude-code-team/bin/ci
# - 送ってよいリポジトリの一覧 → /opt/claude-code-team/etc/github-repos
# - managed settings → /Library/Application Support/ClaudeCode/managed-settings.json（その Mac のすべてのプロジェクトに効く）
#
# 入れる前の managed-settings.json があれば、同じフォルダに managed-settings.json.<日時>.bak として残す。
# .claude/team・.github/scripts を変える PR をマージしたら、もう一度実行する。
# このスクリプトそのものは作業ツリーから動くため、実行する前に git status と git diff で、手元で変わっていないことを確かめる
set -euo pipefail

REPO_URL=https://github.com/saicologic/ai-speak-trace.git
branch=${1:-main}

[ "$(uname -s)" = "Darwin" ] || { echo "macOS で実行してください" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "sudo で実行してください: sudo $0 [<ブランチ>]" >&2; exit 1; }
[ -n "${SUDO_USER-}" ] || { echo "sudo で実行してください（root のまま実行しない）" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です（brew install jq）" >&2; exit 1; }
if [[ "$branch" == -* ]] || ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  echo "ブランチの名前が正しくありません: $branch" >&2
  exit 1
fi

repo=$(cd "$(dirname "$0")/../.." && pwd -P)
# git は、sudo を実行した開発者として動かす（GitHub へのログイン・リポジトリの持ち主を変えないため）。
# リポジトリの設定で、git のフック・fsmonitor・サブモジュール・ext:: のリモートを使わない
as_user() {
  sudo -u "$SUDO_USER" env GIT_CONFIG_COUNT=6 \
    GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null \
    GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false \
    GIT_CONFIG_KEY_2=submodule.recurse GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=fetch.recurseSubmodules GIT_CONFIG_VALUE_3=false \
    GIT_CONFIG_KEY_4=protocol.ext.allow GIT_CONFIG_VALUE_4=never \
    GIT_CONFIG_KEY_5=diff.ignoreSubmodules GIT_CONFIG_VALUE_5=all \
    git -C "$repo" "$@"
}

sha=$(as_user ls-remote "$REPO_URL" "refs/heads/$branch" | cut -f1)
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "GitHub の $branch のコミットを調べられません" >&2; exit 1; }
as_user fetch -q "$REPO_URL" "refs/heads/$branch"
as_user cat-file -e "$sha^{commit}" || { echo "コミット $sha を取り出せません" >&2; exit 1; }

work=$(mktemp -d "/private/tmp/claude-code-team-install.XXXXXX")
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
as_user archive "$sha" .claude/team .github/scripts | tar -x -C "$work"
src="$work/.claude/team"

# 壊れた JSON を入れると、Claude Code が起動しなくなるため、先に確かめる
jq empty "$src/managed-settings.json"

prefix=/opt/claude-code-team
managed_dir="/Library/Application Support/ClaudeCode"
install -d -o root -g wheel -m 755 "$prefix" "$prefix/bin" "$prefix/bin/lib" "$prefix/bin/ci" "$prefix/etc"
# 前に入れたスクリプトで、今はないものを残さない
rm -f "$prefix"/bin/*.sh "$prefix"/bin/lib/* "$prefix"/bin/ci/*
install -o root -g wheel -m 755 "$src"/bin/*.sh "$prefix/bin/"
install -o root -g wheel -m 644 "$src"/bin/lib/* "$prefix/bin/lib/"
install -o root -g wheel -m 644 "$work/.github/scripts/check-tdd-order.sh" "$work/.github/scripts/related-tests.mjs" "$prefix/bin/ci/"
install -o root -g wheel -m 644 "$src/etc/github-repos" "$prefix/etc/github-repos"
printf '%s %s\n' "$branch" "$sha" >"$prefix/etc/installed-from"
chown root:wheel "$prefix/etc/installed-from"

install -d -o root -g wheel -m 755 "$managed_dir"
if [ -f "$managed_dir/managed-settings.json" ]; then
  cp -p "$managed_dir/managed-settings.json" "$managed_dir/managed-settings.json.$(date +%Y%m%d%H%M%S).bak"
fi
install -o root -g wheel -m 644 "$src/managed-settings.json" "$managed_dir/managed-settings.json"

echo "入れました（GitHub の $branch: $sha）:"
echo "  $prefix/bin: $(cd "$prefix/bin" && ls ./*.sh | tr '\n' ' ')"
echo "  $managed_dir/managed-settings.json"
echo "Claude Code を開いている場合は、/status で managed settings が読まれていることを確かめてください"
