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

# 案内する監視のスクリプトは、インストール先のもの
ctx=$(jq -n --arg c "$GH push origin fix/a" '{tool_input: {command: $c}, cwd: "/", tool_response: {stdout: "https://github.com/o/r/pull/9"}}' |
  bash "$BIN/watch-pr-checks.sh" | jq -r '.hookSpecificOutput.additionalContext // empty')
if printf '%s' "$ctx" | grep -qF '`/opt/claude-code-team/bin/wait-pr-checks.sh o/r 9`'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: 監視の案内に /opt/claude-code-team/bin/wait-pr-checks.sh o/r 9 がない\n%s\n' "$ctx"
fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
