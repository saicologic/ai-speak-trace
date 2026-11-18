#!/bin/bash
# Playwright MCP でページを開く（mcp__playwright__browser_navigate）前と後に動く hook
# （managed settings の PreToolUse・PostToolUse。インストール先 /opt/claude-code-team/bin で動く）
#
# - 開く前（PreToolUse）: 許可したサイトなら allow、初めてのサイトなら ask、サイトではない URL（file:・data: など）は deny を返す
# - 開いた後（PostToolUse）: 開けたサイトを、許可したサイトの一覧に足す
#   （一覧にないサイトが開けるのは、ユーザーが確認で許可したときだけなので、許可したサイトが次から確認なしになる）
# - 許可したサイトの一覧: ~/.claude/state/playwright-allowed-origins（1 行に 1 つのオリジン。# で始まる行は読み飛ばす）
#   サンドボックスの中からは書けず、ファイルを書くツールも managed settings の deny（Edit(~/.claude/state/**)）で止める
# - URL の判断は lib/playwright-navigate-gate.mjs（Node の URL で、ブラウザと同じ決まりで読み取る）
# テスト: bash .claude/team/tests/playwright-navigate-gate.test.sh
hook_dir="$(cd "$(dirname "$0")" && pwd)"
list="$HOME/.claude/state/playwright-allowed-origins"
input=$(cat)

# URL を確かめられないときは、確かめる側（ask）に倒す（開いた後の記録はしない）
ask_unchecked() {
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"$1\"}}"
  exit 0
}

event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null) || ask_unchecked "jq を実行できず、URL を確かめられないため確認します（brew install jq）"
command -v node >/dev/null 2>&1 || {
  [ "$event" = PreToolUse ] && ask_unchecked "node が見つからず、URL を確かめられないため確認します"
  exit 0
}
out=$(printf '%s' "$input" | node "$hook_dir/lib/playwright-navigate-gate.mjs" "$list") || {
  [ "$event" = PreToolUse ] && ask_unchecked "URL を確かめられなかったため確認します"
  exit 0
}
[ -n "$out" ] && printf '%s\n' "$out"
exit 0
