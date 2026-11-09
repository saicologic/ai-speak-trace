#!/bin/bash
# cr-review.sh のテスト（bash .claude/team/tests/cr-review.test.sh）
# サンドボックスの外で動くため、リポジトリの git の設定でコマンドを動かされないこと・動かすプログラムを差し替えられないことを確かめる
# （CodeRabbit CLI でのレビューそのものは、外部につなぐため確かめない）
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cr-review-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
git init -q -b main "$repo"
git -C "$repo" commit -q --allow-empty -m init

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

# 親ブランチを表示するだけなら、レビューを動かさずに終わる
out=$(cd "$repo" && bash "$BIN/cr-review.sh" --base-branch main --base 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ "$out" = "main" ]; then ok; else ng "--base-branch main --base（rc=$rc）: $out"; fi

# リポジトリの git の設定に、コマンドを動かす設定があれば断る（--base・--accept・レビュー）
git -C "$repo" config core.fsmonitor "touch $tmp/pwned"
for args in "--base" "--accept" ""; do
  # shellcheck disable=SC2086
  out=$(cd "$repo" && bash "$BIN/cr-review.sh" --base-branch main $args 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'core.fsmonitor'; then ok; else ng "core.fsmonitor があるリポジトリで cr-review.sh $args（rc=$rc）: $out"; fi
done
if [ ! -e "$tmp/pwned" ]; then ok; else ng "リポジトリの設定のコマンドが動いた"; fi
marker="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)/coderabbit-reviewed"
if [ ! -e "$marker" ]; then ok; else ng "設定を断ったのに、レビュー済みにした"; fi

# 動かすプログラムを、環境変数で差し替えられない
if ! grep -q 'CODERABBIT_BIN' "$BIN/cr-review.sh"; then ok; else ng "CODERABBIT_BIN で、動かすプログラムを差し替えられる"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
