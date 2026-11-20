#!/bin/bash
# playwright-navigate-pre.sh・playwright-navigate-post.sh（managed settings の PreToolUse・PostToolUse / mcp__playwright__browser_navigate の hook）のテスト
# （bash .claude/team/tests/playwright-navigate-gate.test.sh）
# 許可したサイトは確認なしで開き、許可していないサイトは初回だけ確かめ、確かめて開けたサイトだけを一覧に足すことを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
# 入口（PATH を決めた値にしてから中身を読む）。下の 14. で確かめる
ENTRY_PRE="$BIN/playwright-navigate-pre.sh"
ENTRY_POST="$BIN/playwright-navigate-post.sh"

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
# 判断の中身（lib/playwright-navigate-gate.sh）を、受け取った PATH のまま動かす入口（node が見つからないときなどを作って確かめるため）
PRE="$tmp/gate-pre.sh"
POST="$tmp/gate-post.sh"
printf '. "%s"\nnavigate_gate pre\n' "$BIN/lib/playwright-navigate-gate.sh" >"$PRE"
printf '. "%s"\nnavigate_gate post\n' "$BIN/lib/playwright-navigate-gate.sh" >"$POST"
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
  pre_input "$1" "toolu_test_$n" | bash "$PRE" | decision_of
}
# check <期待> <URL>
check() {
  local want=$1 url=$2 got
  got=$(decide "$url")
  if [ "$got" = "$want" ]; then ok; else ng "$url（期待 $want、結果 $got）"; fi
}
# 開いた後の hook を流し、何も出さず 0 で終えることを確かめる（足さない場面でも、途中で失敗していないこと）
post_ok() {
  local out rc
  out=$(post_input "$1" "$2" | bash "$POST")
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "開いた後の hook が失敗した（$1、rc=$rc、$out）"; fi
}
# 開く前と開いた後を、同じ tool_use_id で続けて流す（確認で許可して開けたときの流れ）
open_page() {
  n=$((n + 1))
  pre_input "$1" "toolu_test_$n" | bash "$PRE" >/dev/null
  post_input "$1" "toolu_test_$n" | bash "$POST" >/dev/null
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
got=$(jq -n '{hook_event_name: "PreToolUse", tool_use_id: "toolu_nourl", tool_input: {}}' | bash "$PRE" | decision_of)
if [ "$got" = deny ]; then ok; else ng "URL がないときに止めない（結果 $got）"; fi
# browser_navigate で URL がない・null のときも止める（URL のない browser_tabs とは違い、ふだんの確認に任せない）
for i in '{}' '{"url": null}'; do
  got=$(jq -n --argjson i "$i" '{hook_event_name: "PreToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_nourl_nav", tool_input: $i}' | bash "$PRE" | decision_of)
  if [ "$got" = deny ]; then ok; else ng "browser_navigate の URL が $i のときに止めない（結果 $got）"; fi
done
# URL が文字列でないときは止める（文字列にすると URL に見える配列なども、開かない）
for u in '123' 'false' '{}' '["http://localhost:5173/"]' '["file:///etc/hosts"]'; do
  got=$(jq -n --argjson u "$u" '{hook_event_name: "PreToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_badurl", tool_input: {url: $u}}' | bash "$PRE" | decision_of)
  if [ "$got" = deny ]; then ok; else ng "browser_navigate の URL が $u のときに止めない（結果 $got）"; fi
done

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
pre_input 'http://localhost:6290/' toolu_allowed | bash "$PRE" >/dev/null
: >"$LIST"
post_ok 'http://localhost:6290/' toolu_allowed
if grep -qx 'http://localhost:6290' "$LIST"; then ng "確かめずに開いた後に、一覧から消したサイトを足し直した"; else ok; fi
# 開く前の hook を通っていない呼び出し・tool_use_id のない呼び出しの後では足さない
post_ok 'http://localhost:6291/' toolu_unknown
out=$(jq -n '{hook_event_name: "PostToolUse", tool_input: {url: "http://localhost:6292/"}}' | bash "$POST")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "tool_use_id のない呼び出しの後で失敗した（rc=$rc、$out）"; fi
if grep -qE 'localhost:629[12]' "$LIST"; then ng "確かめていない呼び出しの後に足した"; else ok; fi
# 確かめた呼び出しの記録は、開いた後に消す（同じ tool_use_id で二度足さない）
pre_input 'http://localhost:6293/' toolu_once | bash "$PRE" >/dev/null
post_input 'http://localhost:6293/' toolu_once | bash "$POST" >/dev/null
if grep -qx 'http://localhost:6293' "$LIST"; then ok; else ng "確かめて開けたサイトを一覧に足していない（二度目の前）"; fi
: >"$LIST"
post_ok 'http://localhost:6293/' toolu_once
if grep -qx 'http://localhost:6293' "$LIST"; then ng "確かめた呼び出しの記録を消さず、二度目にも足した"; else ok; fi

# 開く前と開いた後で URL が変わったとき（ほかの hook が入力を書き換えたときなど）は、どちらも足さない
pre_input 'http://localhost:6294/' toolu_changed | bash "$PRE" >/dev/null
post_ok 'http://localhost:6295/' toolu_changed
if grep -qE 'localhost:629[45]' "$LIST"; then ng "開く前と開いた後で URL が変わったのに足した"; else ok; fi

# tool_use_id に ../ などが入っていても、記録のフォルダの外（一覧そのもの）を書き換えない
printf '%s\n' 'http://localhost:6400' >"$LIST"
pre_input 'http://localhost:6401/' '../playwright-allowed-origins' | bash "$PRE" >/dev/null
post_input 'http://localhost:6401/' '../playwright-allowed-origins' | bash "$POST" >/dev/null
if [ "$(cat "$LIST")" = 'http://localhost:6400' ]; then ok; else ng "tool_use_id の ../ で一覧を書き換えた（$(cat "$LIST")）"; fi

# 確かめたまま開かなかった呼び出しの記録は、24 時間より古ければ消す（新しい記録は残す）
PENDING="$HOME/.claude/state/playwright-navigate-pending"
mkdir -p "$PENDING"
printf '%s' 'http://localhost:6410' >"$PENDING/toolu_old"
touch -t 202001010000 "$PENDING/toolu_old"
printf '%s' 'http://localhost:6411' >"$PENDING/toolu_new"
pre_input 'http://localhost:6412/' toolu_prune | bash "$PRE" >/dev/null
if [ ! -e "$PENDING/toolu_old" ] && [ -e "$PENDING/toolu_new" ]; then ok; else ng "古い記録を消していない・新しい記録まで消した"; fi

# 記録できないときは、確認は出すが、次も確認することを伝える（「次からは確認しません」と言わない）
rm -rf "$PENDING"
printf 'x' >"$PENDING"
out=$(pre_input 'http://localhost:6420/' toolu_nopending | bash "$PRE")
if [ "$(printf '%s' "$out" | decision_of)" = ask ] && printf '%s' "$out" | grep -q '次回も確認します' && ! printf '%s' "$out" | grep -q '次からは確認しません'; then ok; else ng "記録できないときの確認の文が違う（$out）"; fi
rm -f "$PENDING"

# 確かめた呼び出しの記録を消せないときは、足さずに、理由を標準エラーで伝えて 1 で終える
: >"$LIST"
PENDING="$HOME/.claude/state/playwright-navigate-pending"
pre_input 'http://localhost:6430/' toolu_locked_record | bash "$PRE" >/dev/null
chmod 500 "$PENDING"
err=$(post_input 'http://localhost:6430/' toolu_locked_record | bash "$POST" 2>&1 >/dev/null)
rc=$?
chmod 700 "$PENDING"
if [ "$rc" = 1 ] && printf '%s' "$err" | grep -q '記録を消せません' && ! grep -qx 'http://localhost:6430' "$LIST"; then ok; else ng "記録を消せないときに伝えない・足した（rc=$rc、$err）"; fi

# 一覧に足すのは、ロックを取ってから（ほかのセッションが足している間は待ち、同じ行を二重に足さない）
LOCK="$LIST.lock"
pre_input 'http://localhost:6440/' toolu_lock_a | bash "$PRE" >/dev/null
mkdir "$LOCK"
(post_input 'http://localhost:6440/' toolu_lock_a | bash "$POST" >/dev/null) &
waiter=$!
sleep 1
if grep -qx 'http://localhost:6440' "$LIST"; then ng "ロックを取られている間に足した"; else ok; fi
rmdir "$LOCK"
wait "$waiter"
if grep -qx 'http://localhost:6440' "$LIST"; then ok; else ng "ロックが外れた後に足していない"; fi
# ロックを待っている間に、ほかのセッションが同じサイトを足したら、二重に足さない
pre_input 'http://localhost:6441/' toolu_lock_b | bash "$PRE" >/dev/null
mkdir "$LOCK"
(post_input 'http://localhost:6441/' toolu_lock_b | bash "$POST" >/dev/null) &
waiter=$!
sleep 1
printf '%s\n' 'http://localhost:6441' >>"$LIST"
rmdir "$LOCK"
wait "$waiter"
if [ "$(grep -cx 'http://localhost:6441' "$LIST")" = 1 ]; then ok; else ng "ロックを待っている間に足されたサイトを、二重に足した"; fi
# 古いロック（消し忘れ）は待たない
pre_input 'http://localhost:6442/' toolu_lock_stale | bash "$PRE" >/dev/null
mkdir "$LOCK"
touch -t 202001010000 "$LOCK"
post_ok 'http://localhost:6442/' toolu_lock_stale
if grep -qx 'http://localhost:6442' "$LIST" && [ ! -e "$LOCK" ]; then ok; else ng "古いロックを待ったまま足さない・ロックが残った"; fi

# 古いロックを片付けるのは、片付けのロック（.reclaim）を取ってから（2 つのセッションが同じ古いロックを片付けて、取り直したロックを消さないように）
pre_input 'http://localhost:6444/' toolu_lock_reclaim | bash "$PRE" >/dev/null
mkdir "$LOCK"
touch -t 202001010000 "$LOCK"
mkdir "$LOCK.reclaim"
(post_input 'http://localhost:6444/' toolu_lock_reclaim | bash "$POST" >/dev/null) &
waiter=$!
sleep 1
if [ -d "$LOCK" ] && ! grep -qx 'http://localhost:6444' "$LIST"; then ok; else ng "ほかのセッションが片付けている間に、古いロックを消した・足した"; fi
rmdir "$LOCK.reclaim"
wait "$waiter"
if grep -qx 'http://localhost:6444' "$LIST" && [ ! -e "$LOCK" ] && [ ! -e "$LOCK.reclaim" ]; then ok; else ng "片付けのロックが外れた後に、古いロックを片付けて足していない"; fi
# 片付けのロックも古い（片付けの途中で落ちた）ときは、待たない
pre_input 'http://localhost:6445/' toolu_lock_reclaim_stale | bash "$PRE" >/dev/null
mkdir "$LOCK" "$LOCK.reclaim"
touch -t 202001010000 "$LOCK" "$LOCK.reclaim"
post_ok 'http://localhost:6445/' toolu_lock_reclaim_stale
if grep -qx 'http://localhost:6445' "$LIST" && [ ! -e "$LOCK" ] && [ ! -e "$LOCK.reclaim" ]; then ok; else ng "古い片付けのロックを待ったまま足さない・ロックが残った"; fi
# 2 つのセッションが同じ古いロックを同時に見つけても、どちらのサイトも一覧に残る
pre_input 'http://localhost:6446/' toolu_lock_pair_a | bash "$PRE" >/dev/null
pre_input 'http://localhost:6447/' toolu_lock_pair_b | bash "$PRE" >/dev/null
mkdir "$LOCK"
touch -t 202001010000 "$LOCK"
(post_input 'http://localhost:6446/' toolu_lock_pair_a | bash "$POST" >/dev/null) &
pair_a=$!
(post_input 'http://localhost:6447/' toolu_lock_pair_b | bash "$POST" >/dev/null) &
pair_b=$!
wait "$pair_a" "$pair_b"
if grep -qx 'http://localhost:6446' "$LIST" && grep -qx 'http://localhost:6447' "$LIST" && [ ! -e "$LOCK" ]; then ok; else ng "同じ古いロックを同時に片付けたときに、どちらかのサイトが消えた・ロックが残った"; fi
# ロックを外すのは、自分が取ったロックのときだけ（一覧を書いている間に、ほかのセッションの印に替わったら、消さずに伝える）
cat >"$tmp/steal-lock.cjs" <<'JS'
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const original = fs.renameSync
fs.renameSync = function (from, to, ...rest) {
  const result = original.call(fs, from, to, ...rest)
  if (String(to).endsWith('playwright-allowed-origins')) fs.writeFileSync(`${to}.lock/owner`, 'other-session')
  return result
}
syncBuiltinESMExports()
JS
pre_input 'http://localhost:6448/' toolu_lock_owner | bash "$PRE" >/dev/null
err=$(post_input 'http://localhost:6448/' toolu_lock_owner | node --require "$tmp/steal-lock.cjs" "$BIN/lib/playwright-navigate-gate.mjs" post "$HOME/.claude/state" 2>&1 >/dev/null)
rc=$?
if [ "$rc" = 1 ] && [ "$(cat "$LOCK/owner" 2>/dev/null)" = other-session ] && printf '%s' "$err" | grep -q 'ロック'; then ok; else ng "ほかのセッションのロックを外した・伝えない（rc=$rc、$err）"; fi
rm -rf "$LOCK"

# 古いロックを消せないとき（ロックがフォルダではなくファイルのときなど）も、待つのは決めた時間までで、理由を伝えて 1 で終える
pre_input 'http://localhost:6443/' toolu_lock_file | bash "$PRE" >/dev/null
rm -rf "$LOCK"
: >"$LOCK"
touch -t 202001010000 "$LOCK"
# 判断のスクリプトを、8 秒の時間切れ（perl の alarm）付きで直接流す（待ち続けても、node ごと止まるように）
post_input 'http://localhost:6443/' toolu_lock_file | perl -e 'alarm 8; exec @ARGV' node "$BIN/lib/playwright-navigate-gate.mjs" post "$HOME/.claude/state" >/dev/null 2>&1
rc=$?
if [ "$rc" = 1 ]; then ok; else ng "古いロックを消せないときに、決めた時間で 1 で終えない（rc=$rc。142 は 8 秒の時間切れ）"; fi
rm -f "$LOCK"

# 一覧への書き込みが途中で失敗しても（容量不足など）、切れたオリジンを一覧に残さない
# （書き込みを「半分書いてから容量不足で失敗する」ものに差し替えて、判断のスクリプトを流す）
cat >"$tmp/partial-write.cjs" <<'JS'
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const failing = (original) =>
  function (file, data, ...rest) {
    // 一覧（と一覧の一時ファイル）だけを失敗させる（ロックの持ち主の印は書けるようにして、一覧を書く途中の失敗を確かめる）
    if (String(file).includes('playwright-allowed-origins') && !String(file).includes('.lock')) {
      const text = String(data)
      original.call(fs, file, text.slice(0, Math.floor(text.length / 2)), ...rest)
      const error = new Error('ENOSPC: no space left on device')
      error.code = 'ENOSPC'
      throw error
    }
    return original.call(fs, file, data, ...rest)
  }
fs.appendFileSync = failing(fs.appendFileSync)
fs.writeFileSync = failing(fs.writeFileSync)
syncBuiltinESMExports()
JS
STATE="$HOME/.claude/state"
printf '%s\n' 'http://localhost:6400' >"$LIST"
pre_input 'http://localhost:6451/' toolu_partial | bash "$PRE" >/dev/null
post_input 'http://localhost:6451/' toolu_partial | node --require "$tmp/partial-write.cjs" "$BIN/lib/playwright-navigate-gate.mjs" post "$STATE" >/dev/null 2>&1
rc=$?
if [ "$rc" = 1 ] && [ "$(cat "$LIST")" = 'http://localhost:6400' ]; then ok; else ng "書き込みが途中で失敗したときに、一覧を書き換えた・1 で終えない（rc=$rc、$(tr '\n' ' ' <"$LIST")）"; fi
if ls "$STATE" | grep -vE '^(playwright-allowed-origins|playwright-navigate-pending)$' | grep -q .; then ng "書き込みに失敗した一時ファイルが残った（$(ls "$STATE" | tr '\n' ' ')）"; else ok; fi
if [ ! -e "$LIST.lock" ]; then ok; else ng "書き込みに失敗したときに、ロックが残った"; fi

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

# 開いた後（post）は、開く前の判断を出さず、0 で終える
out=$(post_input 'http://localhost:7001/' toolu_post_only | bash "$POST")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "開いた後に何かを出した・0 で終えない（rc=$rc、$out）"; fi
# 開いた後の hook に、開く前の入力が来ても、判断は出さない
out=$(pre_input 'http://localhost:7002/' toolu_wrong_event | bash "$POST")
if [ -z "$out" ]; then ok; else ng "開いた後の hook が、開く前の入力に判断を出した（$out）"; fi

# 一覧に足せなかったときは、開いた後に、足せなかったことと直し方を伝える（標準エラー・終了コード 1）
rm -rf "$HOME/.claude"
mkdir -p "$LIST"
pre_input 'http://localhost:7003/' toolu_unwritable | bash "$PRE" >/dev/null
err=$(post_input 'http://localhost:7003/' toolu_unwritable | bash "$POST" 2>&1 >/dev/null)
rc=$?
if [ "$rc" = 1 ] && printf '%s' "$err" | grep -q '一覧に足せません'; then ok; else ng "一覧に足せないときに伝えない（rc=$rc、$err）"; fi
rm -rf "$HOME/.claude"

# 13. 新しいタブを開く操作（browser_tabs）で URL を渡したときも、browser_navigate と同じように決める
# tabs_input <PreToolUse|PostToolUse> <tool_use_id> <tool_input の JSON>
tabs_input() { jq -n --arg e "$1" --arg id "$2" --argjson i "$3" '{hook_event_name: $e, tool_name: "mcp__playwright__browser_tabs", tool_use_id: $id, tool_input: $i}'; }
# check_tabs <期待> <tool_input の JSON>
check_tabs() {
  local got
  n=$((n + 1))
  got=$(tabs_input PreToolUse "toolu_tabs_$n" "$2" | bash "$PRE" | decision_of)
  if [ "$got" = "$1" ]; then ok; else ng "browser_tabs $2（期待 $1、結果 $got）"; fi
}
check_tabs allow '{"action": "new", "url": "http://localhost:5173/"}'
check_tabs ask '{"action": "new", "url": "http://localhost:6301/"}'
check_tabs deny '{"action": "new", "url": "file:///etc/hosts"}'
check_tabs deny '{"action": "new", "url": "data:text/html,<script>alert(1)</script>"}'
check_tabs deny '{"action": "new", "url": "http://localhost:5173@evil.example/"}'
check_tabs deny '{"action": "new", "url": ""}'
# new 以外の操作に URL を渡したときも、同じように確かめる（Playwright MCP が使わない値でも、開かないとは限らないため）
check_tabs deny '{"action": "select", "index": 0, "url": "file:///etc/hosts"}'
# URL が文字列でないときも止める
check_tabs deny '{"action": "new", "url": 123}'
check_tabs deny '{"action": "new", "url": false}'
check_tabs deny '{"action": "new", "url": {}}'
check_tabs deny '{"action": "new", "url": ["http://localhost:5173/"]}'
check_tabs deny '{"action": "new", "url": ["file:///etc/hosts"]}'
# URL のない操作（一覧・閉じる・選ぶ・URL のない新しいタブ）は、hook では決めない（何も出さず、ふだんの確認に任せる）
for i in '{"action": "list"}' '{"action": "close", "index": 1}' '{"action": "select", "index": 0}' '{"action": "new"}' '{"action": "new", "url": null}'; do
  out=$(tabs_input PreToolUse toolu_tabs_nourl "$i" | bash "$PRE")
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "URL のない browser_tabs $i で判断を出した・0 で終えない（rc=$rc、$out）"; fi
done
# tool_input そのものがない・null のときも、URL のない操作として決めない
for i in 'tool_input' 'null'; do
  if [ "$i" = tool_input ]; then
    out=$(jq -n '{hook_event_name: "PreToolUse", tool_name: "mcp__playwright__browser_tabs", tool_use_id: "toolu_tabs_noinput"}' | bash "$PRE")
  else
    out=$(tabs_input PreToolUse toolu_tabs_noinput null | bash "$PRE")
  fi
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "tool_input のない browser_tabs（$i）で判断を出した・0 で終えない（rc=$rc、$out）"; fi
done
# 確かめて新しいタブで開けたサイトは一覧に足し、次から確かめない（browser_navigate でも確かめない）
tabs_input PreToolUse toolu_tabs_open '{"action": "new", "url": "http://localhost:6302/a"}' | bash "$PRE" >/dev/null
out=$(tabs_input PostToolUse toolu_tabs_open '{"action": "new", "url": "http://localhost:6302/a"}' | bash "$POST")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "新しいタブで開いた後の hook が失敗した（rc=$rc、$out）"; fi
if grep -qx 'http://localhost:6302' "$LIST"; then ok; else ng "確かめて新しいタブで開けたサイトを一覧に足さない"; fi
check_tabs allow '{"action": "new", "url": "http://localhost:6302/b"}'
check allow 'http://localhost:6302/c'
# URL のない操作の後は、何も出さず 0 で終え、一覧も変えない（同じ tool_use_id で確認の記録が残っていても、足さない）
tabs_input PreToolUse toolu_tabs_list '{"action": "new", "url": "http://localhost:6303/"}' | bash "$PRE" >/dev/null
before=$(cat "$LIST")
out=$(tabs_input PostToolUse toolu_tabs_list '{"action": "list"}' | bash "$POST")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ] && [ "$(cat "$LIST")" = "$before" ]; then ok; else ng "URL のない browser_tabs の後の hook が失敗した・一覧を変えた（rc=$rc、$out）"; fi

# 9. URL を確かめられないとき（node が動かない、判断のスクリプトが失敗した）は、開かない（deny）。理由と直し方を伝える
# （確かめないまま、file:・data: などを確認で許可してしまわないように）
# （hook は jq を使わない。開く前か後かは、入口のスクリプトで分ける）
bash_path=$(command -v bash)
mkdir -p "$tmp/nonode"
for c in cat dirname; do ln -s "$(command -v "$c")" "$tmp/nonode/$c"; done
out=$(pre_input 'http://localhost:5173/' toolu_tools | PATH="$tmp/nonode" "$bash_path" "$PRE")
if [ "$(printf '%s' "$out" | decision_of)" = deny ] && printf '%s' "$out" | grep -q node; then ok; else ng "node が動かないときに理由を添えて止めない（$out）"; fi
# 開いた後に node がないときは、一覧に足せなかったことを標準エラーで伝え、1 で終える（標準出力には何も出さない）
err=$(post_input 'http://localhost:5173/' toolu_tools | PATH="$tmp/nonode" "$bash_path" "$POST" 2>&1 >/dev/null)
rc=$?
out=$(post_input 'http://localhost:5173/' toolu_tools | PATH="$tmp/nonode" "$bash_path" "$POST" 2>/dev/null)
if [ -z "$out" ] && [ "$rc" = 1 ] && printf '%s' "$err" | grep -q node; then ok; else ng "node が動かないときに、開いた後に足せなかったことを伝えない（rc=$rc、$err、$out）"; fi
# node が判断を出さずに 0 で終えたとき（中身のない node など）も、開かない
mkdir -p "$tmp/silentnode"
for c in cat dirname; do ln -s "$(command -v "$c")" "$tmp/silentnode/$c"; done
printf '#!/bin/sh\nexit 0\n' >"$tmp/silentnode/node"
chmod +x "$tmp/silentnode/node"
# node が見つからないときは、URL のない browser_tabs も止める（確かめられないときは、開かない側に倒す）
out=$(tabs_input PreToolUse toolu_tabs_nonode '{"action": "list"}' | PATH="$tmp/nonode" "$bash_path" "$PRE")
if [ "$(printf '%s' "$out" | decision_of)" = deny ]; then ok; else ng "node が見つからないときに、URL のない browser_tabs を止めない（$out）"; fi
out=$(pre_input 'http://localhost:5173/' toolu_silent | PATH="$tmp/silentnode" "$bash_path" "$PRE")
if [ "$(printf '%s' "$out" | decision_of)" = deny ]; then ok; else ng "node が何も出さないときに止めない（$out）"; fi
out=$(printf '%s' '{not json' | bash "$PRE")
if [ "$(printf '%s' "$out" | decision_of)" = deny ] && printf '%s' "$out" | grep -q '確かめられなかった'; then ok; else ng "判断のスクリプトが失敗したときに止めない（$out）"; fi
out=$(printf '%s' '{not json' | bash "$POST" 2>/dev/null)
rc=$?
if [ -z "$out" ] && [ "$rc" = 1 ]; then ok; else ng "判断のスクリプトが失敗したときに、開いた後に何かを出した・1 で終えない（rc=$rc、$out）"; fi

# 14. 入口は、受け取った PATH を使わず、Playwright MCP（playwright-mcp.sh）と同じ決めた場所から node を探す
# （hook はサンドボックスの外で動くため、作業ツリーなどに置いた node を動かさない。node@24 は keg-only で、ふだんの bin にないため）
mcp_path=$(grep -E '^PATH="?/' "$BIN/playwright-mcp.sh")
for f in "$ENTRY_PRE" "$ENTRY_POST"; do
  name=$(basename "$f")
  path_line=$(grep -nE '^PATH="?/' "$f" | head -1)
  source_line=$(grep -nE '^\. ' "$f" | head -1)
  if [ -n "$mcp_path" ] && [ "${path_line#*:}" = "$mcp_path" ]; then ok; else ng "$name で、PATH を playwright-mcp.sh と同じ値にしていない（${path_line#*:}）"; fi
  if grep -qE '^export PATH$' "$f"; then ok; else ng "$name で、PATH を export していない"; fi
  if [ -n "$path_line" ] && [ -n "$source_line" ] && [ "${path_line%%:*}" -lt "${source_line%%:*}" ]; then ok; else ng "$name で、中身を読む前に PATH を決めていない"; fi
done
# 受け取った PATH の先頭に偽の node があっても使わない（偽の node は file: を許可する判断を出し、動いた印を残す）
mkdir -p "$tmp/fakenode"
cat >"$tmp/fakenode/node" <<FAKE
#!/bin/sh
: >"$tmp/fakenode-ran"
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"fake"}}'
FAKE
chmod +x "$tmp/fakenode/node"
rm -f "$tmp/fakenode-ran"
got=$(pre_input 'file:///etc/hosts' toolu_fakenode | PATH="$tmp/fakenode:$PATH" bash "$ENTRY_PRE" | decision_of)
if [ "$got" = deny ] && [ ! -e "$tmp/fakenode-ran" ]; then ok; else ng "開く前の入口が、受け取った PATH の node を使った（結果 $got）"; fi
rm -f "$tmp/fakenode-ran"
post_input 'http://localhost:6304/' toolu_fakenode | PATH="$tmp/fakenode:$PATH" bash "$ENTRY_POST" >/dev/null 2>&1
if [ ! -e "$tmp/fakenode-ran" ]; then ok; else ng "開いた後の入口が、受け取った PATH の node を使った"; fi
# 入口から中身を正しく呼ぶ（開く前は pre・開いた後は post）。決めた PATH に node があるときは、確かめて開けたサイトを一覧に足す
# node がないとき（CI など）は、開いた後の入口が 1 で終える（どちらの場面でも、どちらかを必ず確かめる）
if PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" command -v node >/dev/null 2>&1; then
  got=$(pre_input 'http://localhost:6305/' toolu_entry | bash "$ENTRY_PRE" | decision_of)
  if [ "$got" = ask ]; then ok; else ng "開く前の入口で、初めてのサイトを確かめない（結果 $got）"; fi
  out=$(post_input 'http://localhost:6305/' toolu_entry | bash "$ENTRY_POST")
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ] && grep -qx 'http://localhost:6305' "$LIST"; then ok; else ng "開いた後の入口で、確かめて開けたサイトを一覧に足さない（rc=$rc、$out）"; fi
else
  post_input 'http://localhost:6305/' toolu_entry | bash "$ENTRY_POST" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = 1 ]; then ok; else ng "node がないときに、開いた後の入口が 1 で終えない（rc=$rc）"; fi
fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
