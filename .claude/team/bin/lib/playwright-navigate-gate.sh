# Playwright MCP でページを開く（mcp__playwright__browser_navigate・URL を渡した mcp__playwright__browser_tabs）前と後に動く hook の中身
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

  if ! command -v node >/dev/null 2>&1; then
    [ "$mode" = post ] && {
      echo "node が見つからず、許可したサイトの一覧に足せませんでした。次も確認が出ます。Node を入れてください（brew install node@24）" >&2
      exit 1
    }
    unchecked "node が見つからず、URL を確かめられないため開きません。Node を入れてください（brew install node@24）"
  fi
  if [ "$mode" = pre ]; then
    out=$(printf '%s' "$input" | node "$lib_dir/playwright-navigate-gate.mjs" pre "$state_dir") || unchecked "URL を確かめられなかったため開きません"
    # 判断が出なかったときも、確かめられなかったものとして開かない（何も出さないと、普通の許可の判断に回るため）
    [ -n "$out" ] || unchecked "URL を確かめられなかったため開きません"
    # URL のない browser_tabs（一覧・閉じる・選ぶ）は、hook では決めない
    [ "$out" = NO_DECISION ] && exit 0
    printf '%s\n' "$out"
    exit 0
  fi
  # 開いた後の hook は、1 つずつ順に動かす（perl の flock。プロセスが終わると OS が外すため、落ちた hook のロックが残らない）
  # ロックを持ったまま node を動かす（$^F で、ロックのファイルを exec の後も開いたままにする）。待つのは 3 秒まで
  local flock_path="$state_dir/playwright-allowed-origins.flock" rc
  mkdir -p "$state_dir" && chmod 700 "$state_dir" 2>/dev/null
  printf '%s' "$input" | perl -MFcntl=:flock -MTime::HiRes=time,sleep -e '
    $^F = 255;
    open(my $lock, ">>", shift @ARGV) or exit 3;
    my $deadline = time + 3;
    until (flock($lock, LOCK_EX | LOCK_NB)) { exit 4 if time > $deadline; sleep 0.05 }
    exec @ARGV or exit 3;
  ' "$flock_path" node "$lib_dir/playwright-navigate-gate.mjs" post "$state_dir" >/dev/null
  rc=$?
  case $rc in
    0) exit 0 ;;
    3) echo "許可したサイトの一覧のロック（$flock_path）を開けませんでした。一覧には足していません。次も確認が出ます" >&2 ;;
    4) echo "ほかのセッションが許可したサイトの一覧に足していて、ロック（$flock_path）を取れませんでした。一覧には足していません。次も確認が出ます" >&2 ;;
  esac
  # 開いた後に一覧へ足せなかったときは、標準エラーに理由を書いて 1 で終える（ページを開いたことは取り消さない）
  exit 1
}
