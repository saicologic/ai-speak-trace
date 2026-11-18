#!/bin/bash
# playwright-navigate-gate.sh（managed settings の PreToolUse・PostToolUse / mcp__playwright__browser_navigate の hook）のテスト
# （bash .claude/team/tests/playwright-navigate-gate.test.sh）
# 許可したサイトは確認なしで開き、許可していないサイトは初回だけ確かめ、確かめて開けたサイトだけを一覧に足すことを確かめる
set -u
HOOK="$(cd "$(dirname "$0")/../bin" && pwd)/playwright-navigate-gate.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() {
  fail=$((fail + 1))
  printf 'FAIL: %s\n' "$1"
}

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/playwright-navigate-gate-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home"
mkdir -p "$HOME"
LIST="$HOME/.claude/state/playwright-allowed-origins"
n=0

# pre_input <URL> <tool_use_id>・post_input <URL> <tool_use_id>
pre_input() { jq -n --arg u "$1" --arg id "$2" '{hook_event_name: "PreToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: $id, tool_input: {url: $u}}'; }
post_input() { jq -n --arg u "$1" --arg id "$2" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: $id, tool_input: {url: $u}}'; }
# 出力から判断（allow / ask / deny）を取り出す。何も出さないときは none
decision_of() {
  local out
  out=$(cat)
  if [ -z "$out" ]; then echo none; else printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"'; fi
}
# 開く前の判断（tool_use_id は呼ぶたびに変える）
decide() {
  n=$((n + 1))
  pre_input "$1" "toolu_test_$n" | bash "$HOOK" pre | decision_of
}
# check <期待> <URL>
check() {
  local want=$1 url=$2 got
  got=$(decide "$url")
  if [ "$got" = "$want" ]; then ok; else ng "$url（期待 $want、結果 $got）"; fi
}
# 開く前と開いた後を、同じ tool_use_id で続けて流す（確認で許可して開けたときの流れ）
open_page() {
  n=$((n + 1))
  pre_input "$1" "toolu_test_$n" | bash "$HOOK" pre >/dev/null
  post_input "$1" "toolu_test_$n" | bash "$HOOK" post >/dev/null
}

# 1. 初めから許可するサイト（開発用の画面）
check allow 'http://localhost:5173/'
check allow 'http://127.0.0.1:5173/settings?tab=1#top'
check allow 'http://localhost:5173'

# 3. 許可していないサイトは確かめる（ローカルのほかのポート・外のサイト）
check ask 'http://localhost:6274/'
check ask 'http://127.0.0.1:3000/'
check ask 'https://localhost:5173/'
check ask 'https://example.com/'

# 4. サイトではない URL は止める（手元のファイルを読む・JavaScript を動かす抜け道になるため）
check deny 'file:///etc/hosts'
check deny 'data:text/html,<script>alert(1)</script>'
check deny 'javascript:alert(1)'
check deny 'about:blank'
check deny 'view-source:http://localhost:5173/'

# 5. ユーザー名・パスワードの付いた URL は止める（localhost に見せかけて別のホストを開けるため）
check deny 'http://localhost:5173@evil.example/'
check deny 'http://user:pass@localhost:5173/'

# 6. 読み取れない URL・空の URL・URL がないときは止める
check deny 'not a url'
check deny ''
got=$(jq -n '{hook_event_name: "PreToolUse", tool_use_id: "toolu_nourl", tool_input: {}}' | bash "$HOOK" pre | decision_of)
if [ "$got" = deny ]; then ok; else ng "URL がないときに止めない（結果 $got）"; fi

# 7. 開く URL の大文字・既定のポートは、まとめてから比べる
check allow 'HTTP://LOCALHOST:5173/'
mkdir -p "$(dirname "$LIST")"
printf '%s\n' 'http://localhost' >"$LIST"
check allow 'http://localhost:80/'

# 2. 一覧に足したサイトは確かめずに開く・8. 一覧のコメントと空の行・前後の空白は読み飛ばす
printf '%s\n' '# 許可したサイト' '' '  http://localhost:6274  ' >"$LIST"
check allow 'http://localhost:6274/?token=abc'
check ask 'http://localhost:6275/'

# 一覧の側の大文字・パス・既定のポートも、まとめてから比べる
printf '%s\n' 'HTTP://LOCALHOST:6280' 'http://localhost:6281/path?x=1' 'https://localhost:443' >"$LIST"
check allow 'http://localhost:6280/'
check allow 'http://localhost:6281/'
check allow 'https://localhost/'
# 一覧のサイトではない行・ユーザー名の付いた行・ただの文字の行は読み飛ばす
printf '%s\n' 'file:///x' 'http://u@localhost:6282' 'just text' 'localhost:6283' >"$LIST"
check ask 'http://localhost:6282/'
check ask 'http://localhost:6283/'
rm -f "$LIST"

# 10. 確かめて開けたサイトは一覧に足し、次から確かめない
check ask 'http://localhost:6274/'
open_page 'http://localhost:6274/?token=abc'
if [ -f "$LIST" ] && grep -qx 'http://localhost:6274' "$LIST"; then ok; else ng "確かめて開けたサイトを一覧に足していない"; fi
check allow 'http://localhost:6274/other'

# 11. すでに一覧にあるサイト・初めから許可するサイトは、二重に足さない
open_page 'http://localhost:6274/again'
open_page 'http://localhost:5173/'
if [ "$(grep -cx 'http://localhost:6274' "$LIST")" = 1 ]; then ok; else ng "一覧にあるサイトを二重に足した"; fi
if grep -qx 'http://localhost:5173' "$LIST"; then ng "初めから許可するサイトを一覧に足した"; else ok; fi

# 12. サイトではない URL は、開けても一覧に足さない
open_page 'file:///etc/hosts'
open_page 'data:text/html,hello'
if grep -qE '^(file|data|null)' "$LIST"; then ng "サイトではない URL を一覧に足した"; else ok; fi

# 確かめなかった呼び出し（一覧にあったため allow にしたもの）の後では足さない
# （開いている間に一覧から消したサイトを、開き終わったときに足し直さない）
printf '%s\n' 'http://localhost:6290' >"$LIST"
pre_input 'http://localhost:6290/' toolu_allowed | bash "$HOOK" pre >/dev/null
: >"$LIST"
post_input 'http://localhost:6290/' toolu_allowed | bash "$HOOK" post >/dev/null
if grep -qx 'http://localhost:6290' "$LIST"; then ng "確かめずに開いた後に、一覧から消したサイトを足し直した"; else ok; fi
# 開く前の hook を通っていない呼び出し・tool_use_id のない呼び出しの後では足さない
post_input 'http://localhost:6291/' toolu_unknown | bash "$HOOK" post >/dev/null
jq -n '{hook_event_name: "PostToolUse", tool_input: {url: "http://localhost:6292/"}}' | bash "$HOOK" post >/dev/null
if grep -qE 'localhost:629[12]' "$LIST"; then ng "確かめていない呼び出しの後に足した"; else ok; fi
# 確かめた呼び出しの記録は、開いた後に消す（同じ tool_use_id で二度足さない）
pre_input 'http://localhost:6293/' toolu_once | bash "$HOOK" pre >/dev/null
post_input 'http://localhost:6293/' toolu_once | bash "$HOOK" post >/dev/null
: >"$LIST"
post_input 'http://localhost:6293/' toolu_once | bash "$HOOK" post >/dev/null
if grep -qx 'http://localhost:6293' "$LIST"; then ng "確かめた呼び出しの記録を消さず、二度目にも足した"; else ok; fi

# 末尾に改行のない一覧に足しても、行がつながらない
printf '%s' 'http://localhost:6300' >"$LIST"
open_page 'http://localhost:6301/'
check allow 'http://localhost:6300/'
check allow 'http://localhost:6301/'
printf '%s' '# コメント' >"$LIST"
open_page 'http://localhost:6302/'
check allow 'http://localhost:6302/'

# 一覧のフォルダがなくても、作ってから足す
rm -rf "$HOME/.claude"
open_page 'http://localhost:7000/'
if [ -f "$LIST" ] && grep -qx 'http://localhost:7000' "$LIST"; then ok; else ng "一覧のフォルダがないときに足せない"; fi

# 開いた後（post）は、開く前の判断を出さない
out=$(post_input 'http://localhost:7001/' toolu_post_only | bash "$HOOK" post)
if [ -z "$out" ]; then ok; else ng "開いた後に何かを出した（$out）"; fi
# 想定していない呼び方（引数がない・ほかの引数）では、何もしない
for arg in '' other; do
  out=$(pre_input 'http://localhost:7002/' "toolu_arg_$arg" | bash "$HOOK" $arg)
  if [ -z "$out" ]; then ok; else ng "引数「$arg」で何かを出した（$out）"; fi
done

# 一覧に足せなかったときは、開いた後に、足せなかったことと直し方を伝える（標準エラー・終了コード 1）
rm -rf "$HOME/.claude"
mkdir -p "$LIST"
pre_input 'http://localhost:7003/' toolu_unwritable | bash "$HOOK" pre >/dev/null
err=$(post_input 'http://localhost:7003/' toolu_unwritable | bash "$HOOK" post 2>&1 >/dev/null)
rc=$?
if [ "$rc" = 1 ] && printf '%s' "$err" | grep -q '一覧に足せません'; then ok; else ng "一覧に足せないときに伝えない（rc=$rc、$err）"; fi
rm -rf "$HOME/.claude"

# 9. URL を確かめられないとき（node が動かない、判断のスクリプトが失敗した）は、確かめる側（ask）に倒し、理由を伝える
# （hook は jq を使わない。開く前か後かは、managed settings で渡す引数で決める）
bash_path=$(command -v bash)
mkdir -p "$tmp/nonode"
for c in cat dirname; do ln -s "$(command -v "$c")" "$tmp/nonode/$c"; done
out=$(pre_input 'http://localhost:5173/' toolu_tools | PATH="$tmp/nonode" "$bash_path" "$HOOK" pre)
if [ "$(printf '%s' "$out" | decision_of)" = ask ] && printf '%s' "$out" | grep -q node; then ok; else ng "node が動かないときに理由を添えて ask にしない（$out）"; fi
out=$(post_input 'http://localhost:5173/' toolu_tools | PATH="$tmp/nonode" "$bash_path" "$HOOK" post 2>/dev/null)
if [ -z "$out" ]; then ok; else ng "node が動かないときに、開いた後に何かを出した（$out）"; fi
out=$(printf '%s' '{not json' | bash "$HOOK" pre)
if [ "$(printf '%s' "$out" | decision_of)" = ask ] && printf '%s' "$out" | grep -q '確かめられなかった'; then ok; else ng "判断のスクリプトが失敗したときに ask にしない（$out）"; fi
out=$(printf '%s' '{not json' | bash "$HOOK" post 2>/dev/null)
if [ -z "$out" ]; then ok; else ng "判断のスクリプトが失敗したときに、開いた後に何かを出した（$out）"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
