#!/bin/bash
# playwright-navigate-gate.sh（managed settings の PreToolUse・PostToolUse / mcp__playwright__browser_navigate の hook）のテスト
# （bash .claude/team/tests/playwright-navigate-gate.test.sh）
# 許可したサイトは確認なしで開き、許可していないサイトは初回だけ確かめ、許可したら一覧に足すことを確かめる
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

# 開く前の判断（allow / ask / deny）。hook が何も返さないときは none
decide() {
  local out
  out=$(jq -n --arg u "$1" '{hook_event_name: "PreToolUse", tool_name: "mcp__playwright__browser_navigate", tool_input: {url: $u}}' | bash "$HOOK")
  if [ -z "$out" ]; then
    echo none
  else
    printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"'
  fi
}
# check <期待> <URL>
check() {
  local want=$1 url=$2 got
  got=$(decide "$url")
  if [ "$got" = "$want" ]; then ok; else ng "$url（期待 $want、結果 $got）"; fi
}
# 開いた後（PostToolUse）の記録
opened() {
  jq -n --arg u "$1" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_input: {url: $u}}' | bash "$HOOK" >/dev/null
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

# 6. 読み取れない URL・空の URL は止める
check deny 'not a url'
check deny ''

# 7. 大文字・既定のポートは、まとめてから比べる
check allow 'HTTP://LOCALHOST:5173/'
mkdir -p "$(dirname "$LIST")"
printf '%s\n' 'http://localhost' >"$LIST"
check allow 'http://localhost:80/'

# 2. 一覧に足したサイトは確かめずに開く・8. 一覧のコメントと空の行は読み飛ばす
printf '%s\n' '# 許可したサイト' '' '  http://localhost:6274  ' >"$LIST"
check allow 'http://localhost:6274/?token=abc'
check ask 'http://localhost:6275/'
rm -f "$LIST"

# 10. 開けたサイト（確認で許可したもの）は一覧に足し、次から確かめない
check ask 'http://localhost:6274/'
opened 'http://localhost:6274/?token=abc'
if [ -f "$LIST" ] && grep -qx 'http://localhost:6274' "$LIST"; then ok; else ng "開けたサイトを一覧に足していない"; fi
check allow 'http://localhost:6274/other'

# 11. すでに一覧にあるサイト・初めから許可するサイトは、二重に足さない
opened 'http://localhost:6274/again'
opened 'http://localhost:5173/'
if [ "$(grep -cx 'http://localhost:6274' "$LIST")" = 1 ]; then ok; else ng "一覧にあるサイトを二重に足した"; fi
if grep -qx 'http://localhost:5173' "$LIST"; then ng "初めから許可するサイトを一覧に足した"; else ok; fi

# 12. サイトではない URL は、開けても一覧に足さない
opened 'file:///etc/hosts'
opened 'data:text/html,hello'
if grep -qE '^(file|data|null)' "$LIST"; then ng "サイトではない URL を一覧に足した"; else ok; fi

# 一覧のフォルダがなくても、作ってから足す
rm -rf "$HOME/.claude"
opened 'http://localhost:7000/'
if [ -f "$LIST" ] && grep -qx 'http://localhost:7000' "$LIST"; then ok; else ng "一覧のフォルダがないときに足せない"; fi

# 9. node が動かないときは、URL を確かめられないので、確かめる側（ask）に倒す
mkdir -p "$tmp/bin"
for c in jq cat grep mkdir dirname; do ln -s "$(command -v "$c")" "$tmp/bin/$c"; done
bash_path=$(command -v bash)
got=$(jq -n '{hook_event_name: "PreToolUse", tool_input: {url: "http://localhost:5173/"}}' | PATH="$tmp/bin" "$bash_path" "$HOOK" | jq -r '.hookSpecificOutput.permissionDecision // "none"')
if [ "$got" = ask ]; then ok; else ng "node が動かないときに ask にしない（結果 $got）"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
