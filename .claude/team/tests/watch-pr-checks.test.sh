#!/bin/bash
# watch-pr-checks.sh（PostToolUse / Bash）のテスト（bash .claude/team/tests/watch-pr-checks.test.sh）
# PR を更新する操作の後だけ、インストール先の wait-pr-checks.sh で監視するよう案内することを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
GH=/opt/claude-code-team/bin/github.sh

pass=0
fail=0
# check <期待（watch / none）> <コマンド>
check() {
  local want=$1 cmd=$2 ctx got
  ctx=$(jq -n --arg c "$cmd" '{tool_input: {command: $c}, cwd: "/", tool_response: {stdout: "https://github.com/o/r/pull/9"}}' |
    bash "$BIN/watch-pr-checks.sh" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -n "$ctx" ]; then got=watch; else got=none; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s（期待 %s、結果 %s）\n' "$cmd" "$want" "$got"
  fi
}

check watch "$GH push origin fix/a"
check watch "$GH push -u origin HEAD:refs/heads/fix/a"
check watch "$GH --skip SKIP_CR_LOOP push origin fix/a"
check watch "$GH pr create --draft --title t --body-file b.md"
check none "$GH push --dry-run origin fix/a"
check none "$GH pr view 9"
check none "$GH fetch origin"
check none "git status"
# インストール先でない github.sh（リポジトリの中のものなど）の後は、監視しない
check none ".claude/team/bin/github.sh push origin fix/a"
check none "/tmp/x/github.sh push origin fix/a"

# 案内する監視のスクリプトは、インストール先のもの
ctx=$(jq -n --arg c "$GH push origin fix/a" '{tool_input: {command: $c}, cwd: "/", tool_response: {stdout: "https://github.com/o/r/pull/9"}}' |
  bash "$BIN/watch-pr-checks.sh" | jq -r '.hookSpecificOutput.additionalContext // empty')
if printf '%s' "$ctx" | grep -qF '`/opt/claude-code-team/bin/wait-pr-checks.sh o/r 9`'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: 監視の案内に /opt/claude-code-team/bin/wait-pr-checks.sh o/r 9 がない\n%s\n' "$ctx"
fi

# 出力に PR がないときは gh で今のブランチの PR を調べる。サンドボックスの外で動くため、
# リポジトリの git の設定に認めていない項目があれば、gh（中で git を動かす）を動かさずに終わる
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/watch-pr-checks-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
echo called >>"$tmp/gh-called"
echo "9 https://github.com/o/r/pull/9"
EOF
chmod +x "$tmp/bin/gh"
git init -q -b main "$tmp/repo"
# watch_in_repo: repo で、出力に PR のない push の後の hook を流し、案内が出たら watch を出す
watch_in_repo() {
  rm -f "$tmp/gh-called"
  jq -n --arg c "$GH push origin fix/a" --arg d "$tmp/repo" '{tool_input: {command: $c}, cwd: $d, tool_response: {stdout: ""}}' |
    PATH="$tmp/bin:$PATH" bash "$BIN/watch-pr-checks.sh" | jq -r 'if .hookSpecificOutput.additionalContext then "watch" else "none" end'
}
if [ "$(watch_in_repo)" = watch ] && [ -e "$tmp/gh-called" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: 出力に PR がないとき、gh で PR を調べる"; fi
git -C "$tmp/repo" config core.fsmonitor "touch $tmp/pwned"
if [ "$(watch_in_repo)" != watch ] && [ ! -e "$tmp/gh-called" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: リポジトリの設定に core.fsmonitor があるのに、gh を動かした"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
