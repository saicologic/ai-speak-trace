# Playwright MCP でページを開く（mcp__playwright__browser_navigate）前と後に動く hook の中身
# 入口: bin/playwright-navigate-pre.sh（PreToolUse）・bin/playwright-navigate-post.sh（PostToolUse）から読み込み、navigate_gate pre / post を呼ぶ
#
# - 開く前: 許可したサイトなら allow、初めてのサイトなら ask、サイトではない URL（file:・data: など）と、URL を確かめられないときは deny を返す
#   （この hook が起動できない・時間切れのときも、managed settings の onFailure: block で開かない）
#   ask にした呼び出しは、tool_use_id ごとに ~/.claude/state/playwright-navigate-pending に記録する
# - 開いた後: 開く前に ask にした呼び出し（ユーザーが確認で許可して開けたもの）だけ、そのサイトを一覧に足す
# - 許可したサイトの一覧: ~/.claude/state/playwright-allowed-origins（1 行に 1 つのオリジン。# で始まる行は読み飛ばす）
#   サンドボックスの中からは書けず、ファイルを書くツールも managed settings の deny（Edit(~/.claude/state/**)）で止める
# - URL の判断は playwright-navigate-gate.mjs（Node の URL で、ブラウザと同じ決まりで読み取る）
# テスト: bash .claude/team/tests/playwright-navigate-gate.test.sh
navigate_gate() {
  local mode=$1 lib_dir state_dir input out
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  state_dir="$HOME/.claude/state"
  input=$(cat)

  # URL を確かめられないときは、開く前は開かない（deny。確かめないまま file:・data: などを許可しないように）。開いた後は何もしない
  unchecked() {
    [ "$mode" = pre ] && printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$1\"}}"
    exit 0
  }

  command -v node >/dev/null 2>&1 || unchecked "node が見つからず、URL を確かめられないため開きません。Node を入れてください（brew install node@24）"
  if [ "$mode" = pre ]; then
    out=$(printf '%s' "$input" | node "$lib_dir/playwright-navigate-gate.mjs" pre "$state_dir") || unchecked "URL を確かめられなかったため開きません"
    [ -n "$out" ] && printf '%s\n' "$out"
    exit 0
  fi
  # 開いた後に一覧へ足せなかったときは、標準エラーに理由を書いて 1 で終える（ページを開いたことは取り消さない）
  printf '%s' "$input" | node "$lib_dir/playwright-navigate-gate.mjs" post "$state_dir" >/dev/null || exit 1
  exit 0
}
