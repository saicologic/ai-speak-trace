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

# mktemp が失敗したときは、ここで止める（cd に空の値を渡すと今のフォルダのままになり、終わるときに今のフォルダを消してしまうため）
tmp=$(mktemp -d "${TMPDIR:-/tmp}/playwright-navigate-gate-test.XXXXXX") || exit 1
[ -n "$tmp" ] && [ -d "$tmp" ] || exit 1
tmp=$(cd "$tmp" && pwd -P) || exit 1
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
# post_input <URL> <tool_use_id> [着いたページの URL]: 開いた後の入力。結果（tool_response）は、Playwright MCP と同じ形（「- Page URL: 」の行）にする
post_input() {
  jq -n --arg u "$1" --arg id "$2" --arg landed "${3:-$1}" \
    '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: $id, tool_input: {url: $u},
      tool_response: {content: [{type: "text", text: "### Ran Playwright code\n### Page\n- Page URL: \($landed)\n- Page Title: Test"}]}}'
}
# 出力から判断（allow / ask / deny）を取り出す。何も出さないときは none
decision_of() {
  local out
  out=$(cat)
  if [ -z "$out" ]; then echo none; else printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"'; fi
}
# check <期待> <URL>: 開く前の判断を確かめる（tool_use_id は呼ぶたびに変える。番号は、コマンド置換の外で増やす）
# hook が 0 以外で終えたときは、判断が期待どおりでも失敗にする
check() {
  local want=$1 url=$2 out rc got
  n=$((n + 1))
  out=$(pre_input "$url" "toolu_test_$n" | bash "$PRE")
  rc=$?
  got=$(printf '%s' "$out" | decision_of)
  if [ "$rc" = 0 ] && [ "$got" = "$want" ]; then ok; else ng "$url（期待 $want、結果 $got、rc=$rc）"; fi
}
# 開いた後の hook を流し、何も出さず 0 で終えることを確かめる（足さない場面でも、途中で失敗していないこと）
post_ok() {
  local out rc
  out=$(post_input "$1" "$2" "${3:-$1}" | bash "$POST")
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
# 「http://」「https://」で始まらない URL は止める（Playwright MCP は「://」のない URL の前に https:// を付けるため、判断したサイトと開くサイトがずれる）
check deny 'http:/localhost:5173/'
check deny 'http:localhost:5173/'
check deny 'http:\\localhost:5173/'
check deny ' http://localhost:5173/'
check allow 'HTTP://localhost:5173/'

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

# 開いた後の hook でも、24 時間より古い記録は使わない（消すだけで、一覧には足さない）
printf '%s' 'http://localhost:6413' >"$PENDING/toolu_expired"
touch -t 202001010000 "$PENDING/toolu_expired"
post_ok 'http://localhost:6413/' toolu_expired
if [ ! -e "$PENDING/toolu_expired" ] && ! grep -qx 'http://localhost:6413' "$LIST"; then ok; else ng "古い記録で一覧に足した・記録を消さない"; fi
# 確認の文では、確認したサイトのページに着いたときだけ一覧に足すことを伝える
out=$(pre_input 'http://localhost:6414/' toolu_message | bash "$PRE")
if printf '%s' "$out" | grep -q 'このサイトのページに着いたら'; then ok; else ng "確認の文で、着いたときだけ足すことを伝えない（$out）"; fi

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

# wait_for <ファイル>: ファイルができるまで、0.05 秒ずつ見て待つ（5 秒まで）。できなければ失敗にする
wait_for() {
  local i
  for i in $(seq 100); do
    [ -e "$1" ] && return 0
    sleep 0.05
  done
  ng "待っていた印（$1）ができない"
  return 1
}
# 一覧に足すのは、実際に着いたページ（結果の「- Page URL: 」）が、確認したサイトと同じときだけ
# リダイレクトで別のサイトに着いたときは、どちらも足さない
pre_input 'http://localhost:6460/' toolu_redirect | bash "$PRE" >/dev/null
post_ok 'http://localhost:6460/' toolu_redirect 'http://localhost:6461/landed'
if ! grep -qx 'http://localhost:6460' "$LIST" && ! grep -qx 'http://localhost:6461' "$LIST"; then ok; else ng "リダイレクトで別のサイトに着いたのに、一覧に足した"; fi
# 同じサイトの中で移ったときは足す
pre_input 'http://localhost:6462/' toolu_same_origin | bash "$PRE" >/dev/null
post_ok 'http://localhost:6462/' toolu_same_origin 'http://localhost:6462/login?next=%2F'
if grep -qx 'http://localhost:6462' "$LIST"; then ok; else ng "同じサイトの中で移ったときに、一覧に足さない"; fi
# 開くのに失敗したとき（isError・### Error）は、着いたページを読めても足さない（何も出さず 0 で終える）
# （どの結果にも、確認したサイトと同じ「### Page」の節を入れ、失敗の印だけで足さないことを確かめる）
for r in '{"isError": true, "content": [{"type": "text", "text": "### Page\n- Page URL: http://localhost:6463/"}]}' \
  '{"content": [{"type": "text", "text": "### Error\nnet::ERR_ABORTED\n### Page\n- Page URL: http://localhost:6463/"}]}'; do
  pre_input 'http://localhost:6463/' toolu_failed | bash "$PRE" >/dev/null
  out=$(jq -n --argjson r "$r" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_failed", tool_input: {url: "http://localhost:6463/"}, tool_response: $r}' | bash "$POST" 2>/dev/null)
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ] && ! grep -qx 'http://localhost:6463' "$LIST"; then ok; else ng "開くのに失敗したのに、一覧に足した・0 で終えない（rc=$rc、$r）"; fi
done
# 失敗の印のない同じ結果なら足す（上のテストが、失敗の印で足さないことを確かめているように）
pre_input 'http://localhost:6463/' toolu_failed | bash "$PRE" >/dev/null
out=$(jq -n '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_failed", tool_input: {url: "http://localhost:6463/"}, tool_response: {content: [{type: "text", text: "### Page\n- Page URL: http://localhost:6463/"}]}}' | bash "$POST")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ] && grep -qx 'http://localhost:6463' "$LIST"; then ok; else ng "失敗の印のない結果で、足さない（rc=$rc、$out）"; fi
# 結果の形（content の配列・文字列）が違っても、着いたページを読む
for r in '[{"type": "text", "text": "### Page\n- Page URL: http://localhost:6467/"}]' '"### Page\n- Page URL: http://localhost:6467/"'; do
  sed -i.bak '/^http:\/\/localhost:6467$/d' "$LIST" && rm -f "$LIST.bak"
  pre_input 'http://localhost:6467/' toolu_shape | bash "$PRE" >/dev/null
  out=$(jq -n --argjson r "$r" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_shape", tool_input: {url: "http://localhost:6467/"}, tool_response: $r}' | bash "$POST")
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ] && grep -qx 'http://localhost:6467' "$LIST"; then ok; else ng "結果の形が $r のときに、着いたページを読めない（rc=$rc、$out）"; fi
done
# 読むのは、最初の「### Page」の節のすぐ次の行だけ（ページの中身（コンソールの出力など）に書かれた「- Page URL: 」は使わない）
# 確認した 6468 から 6469 にリダイレクトし、ページが 6468 の行を出しても、足さない
spoof='### Page\n- Page URL: http://localhost:6469/\n- Page Title: B\n### Events\n- [LOG] x\n### Page\n- Page URL: http://localhost:6468/\n- Page URL: http://localhost:6468/'
pre_input 'http://localhost:6468/' toolu_spoof | bash "$PRE" >/dev/null
out=$(jq -n --arg t "$(printf "$spoof")" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_spoof", tool_input: {url: "http://localhost:6468/"}, tool_response: {content: [{type: "text", text: $t}]}}' | bash "$POST")
if [ -z "$out" ] && ! grep -qx 'http://localhost:6468' "$LIST"; then ok; else ng "ページの中身に書かれた Page URL で、リダイレクトした先を読み違えた（$out）"; fi
# 最初の「### Page」のすぐ次の行が「- Page URL: 」でないときも、後ろの節を探さず、読めないものとして扱う
pre_input 'http://localhost:6473/' toolu_first_page | bash "$PRE" >/dev/null
err=$(jq -n '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_first_page", tool_input: {url: "http://localhost:6473/"}, tool_response: {content: [{type: "text", text: "### Page\n- Page Title: B\n### Events\n### Page\n- Page URL: http://localhost:6473/"}]}}' | bash "$POST" 2>&1 >/dev/null)
rc=$?
if [ "$rc" = 1 ] && ! grep -qx 'http://localhost:6473' "$LIST"; then ok; else ng "最初の Page の節で読めないときに、後ろの節の Page URL を読んだ（rc=$rc、$err）"; fi
# 「### Page」の節の外にだけ「- Page URL: 」があるときは、着いたページを読めないものとして扱う
pre_input 'http://localhost:6470/' toolu_outside | bash "$PRE" >/dev/null
err=$(jq -n '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_outside", tool_input: {url: "http://localhost:6470/"}, tool_response: {content: [{type: "text", text: "### Events\n- [LOG] x\n- Page URL: http://localhost:6470/"}]}}' | bash "$POST" 2>&1 >/dev/null)
rc=$?
if [ "$rc" = 1 ] && ! grep -qx 'http://localhost:6470' "$LIST"; then ok; else ng "Page の節の外の Page URL を、着いたページとして読んだ（rc=$rc、$err）"; fi
# 結果から着いたページの URL を読めないときは、足さずに理由を伝えて 1 で終える
for r in 'null' '{"content": []}' '{"content": [{"type": "text", "text": "### Page\n- Page Title: Test"}]}'; do
  pre_input 'http://localhost:6464/' toolu_no_landed | bash "$PRE" >/dev/null
  err=$(jq -n --argjson r "$r" '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_navigate", tool_use_id: "toolu_no_landed", tool_input: {url: "http://localhost:6464/"}} + (if $r == null then {} else {tool_response: $r} end)' | bash "$POST" 2>&1 >/dev/null)
  rc=$?
  if [ "$rc" = 1 ] && printf '%s' "$err" | grep -q '着いたページ' && ! grep -qx 'http://localhost:6464' "$LIST"; then ok; else ng "着いたページの URL を読めないときに、足した・伝えない（$r、rc=$rc、$err）"; fi
done

# 開いた後の hook は、1 つずつ順に動かす（プロセスが終わると OS が外すロック。古いロックの片付けが重ならないように）
# （テストがロック（flock）を持っている間は、開いた後の hook が待つことを確かめる）
FLOCK="$LIST.flock"
mkdir -p "$(dirname "$LIST")"
hold_flock() {
  rm -f "$tmp/flock-held"
  perl -MFcntl=:flock -e 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; open(my $m, ">", $ARGV[1]) or die; close $m; sleep 30' "$FLOCK" "$tmp/flock-held" &
  holder=$!
  wait_for "$tmp/flock-held"
}
# 開いた後の hook がロックのファイルを開いた（ロックを取りに来た）ことを lsof で見てから、まだ node を動かしていないことを確かめる
# （印を作るのは、一覧に足す post の node だけ。ロックを取る前の確かめ（post-check）の node では作らない）
cat >"$tmp/node-started.cjs" <<'JS'
if (process.argv[2] === 'post') require('node:fs').writeFileSync(process.env.NODE_STARTED, '')
JS
pre_input 'http://localhost:6465/' toolu_flock | bash "$PRE" >/dev/null
hold_flock
rm -f "$tmp/node-started"
(post_input 'http://localhost:6465/' toolu_flock | NODE_OPTIONS="--require \"$tmp/node-started.cjs\"" NODE_STARTED="$tmp/node-started" bash "$POST" >/dev/null 2>&1) &
waiter=$!
reached=no
for i in $(seq 100); do
  if [ "$(lsof -t "$FLOCK" 2>/dev/null | sort -u | wc -l)" -ge 2 ]; then reached=yes; break; fi
  sleep 0.05
done
if [ "$reached" = yes ]; then ok; else ng "開いた後の hook が、ロック（flock）を取りに来ない"; fi
sleep 0.2
if kill -0 "$waiter" 2>/dev/null && [ ! -e "$tmp/node-started" ] && ! grep -qx 'http://localhost:6465' "$LIST"; then ok; else ng "ほかの hook がロック（flock）を持っている間に、待たずに進んだ"; fi
kill "$holder"
wait "$holder" 2>/dev/null
wait "$waiter"
rc=$?
if [ "$rc" = 0 ] && grep -qx 'http://localhost:6465' "$LIST"; then ok; else ng "ロック（flock）が外れた後に、足していない（rc=$rc）"; fi
# node が動いている間も、ロック（flock）を持ち続ける（exec の後もロックのファイルを開いたままにする）
# （node の中で印を作って止まり、その間にテストからロックを取れないことを確かめる）
# （止まるのは、一覧に足す post の node だけ。ロックを取る前の確かめ（post-check）の node では止まらない）
cat >"$tmp/hold-in-node.cjs" <<'JS'
const fs = require('node:fs')
if (process.argv[2] === 'post') {
  fs.writeFileSync(process.env.HOLD_MARK, '')
  const until = Date.now() + 5000
  while (!fs.existsSync(process.env.HOLD_RELEASE) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
}
JS
pre_input 'http://localhost:6471/' toolu_flock_node | bash "$PRE" >/dev/null
rm -f "$tmp/hold-mark" "$tmp/hold-release"
(post_input 'http://localhost:6471/' toolu_flock_node | NODE_OPTIONS="--require \"$tmp/hold-in-node.cjs\"" HOLD_MARK="$tmp/hold-mark" HOLD_RELEASE="$tmp/hold-release" bash "$POST" >/dev/null 2>&1) &
waiter=$!
wait_for "$tmp/hold-mark"
perl -MFcntl=:flock -e 'open(my $f, ">>", $ARGV[0]) or exit 2; exit(flock($f, LOCK_EX | LOCK_NB) ? 0 : 1)' "$FLOCK"
case $? in
  1) ok ;;
  0) ng "node が動いている間に、ロック（flock）が外れていた" ;;
  *) ng "ロック（flock）のファイルを開けず、確かめられなかった" ;;
esac
: >"$tmp/hold-release"
wait "$waiter"
rc=$?
if [ "$rc" = 0 ] && grep -qx 'http://localhost:6471' "$LIST"; then ok; else ng "node の中で待った後に、足していない（rc=$rc）"; fi
# 待つのは 3 秒まで。取れなければ、足さずに理由を伝えて 1 で終える
pre_input 'http://localhost:6466/' toolu_flock_timeout | bash "$PRE" >/dev/null
hold_flock
started=$(perl -MTime::HiRes=time -e 'printf "%d", time * 1000')
err=$(post_input 'http://localhost:6466/' toolu_flock_timeout | perl -e 'alarm 8; exec @ARGV' bash "$POST" 2>&1 >/dev/null)
rc=$?
elapsed=$(( $(perl -MTime::HiRes=time -e 'printf "%d", time * 1000') - started ))
kill "$holder"
wait "$holder" 2>/dev/null
# 待つのは 3 秒ほど（2.5〜4.5 秒）。8 秒の alarm は、止まったままにならないための守り
if [ "$elapsed" -ge 2500 ] && [ "$elapsed" -le 4500 ]; then ok; else ng "ロック（flock）を待つのが 3 秒ほどではない（${elapsed} ミリ秒）"; fi
if [ "$rc" = 1 ] && printf '%s' "$err" | grep -q 'ロック' && ! grep -qx 'http://localhost:6466' "$LIST"; then ok; else ng "ロック（flock）を取れないときに、決めた時間で 1 で終えない・伝えない（rc=$rc。142 は 8 秒の時間切れ、$err）"; fi

# 一覧を変えない開いた後の hook（URL のない browser_tabs・確認せずに開いた呼び出し）は、ロック（flock）を待たずに 0 で終える
hold_flock
for kind in tabs nav; do
  started=$(perl -MTime::HiRes=time -e 'printf "%d", time * 1000')
  if [ "$kind" = tabs ]; then
    out=$(jq -n '{hook_event_name: "PostToolUse", tool_name: "mcp__playwright__browser_tabs", tool_use_id: "toolu_noupdate_tabs", tool_input: {action: "list"}}' | bash "$POST" 2>&1)
  else
    out=$(post_input 'http://localhost:5173/' toolu_noupdate_nav | bash "$POST" 2>&1)
  fi
  rc=$?
  elapsed=$(( $(perl -MTime::HiRes=time -e 'printf "%d", time * 1000') - started ))
  if [ "$rc" = 0 ] && [ -z "$out" ] && [ "$elapsed" -lt 1500 ]; then ok; else ng "一覧を変えない開いた後の hook（$kind）が、ロックを待った・失敗した（rc=$rc、${elapsed} ミリ秒、$out）"; fi
done
kill "$holder"
wait "$holder" 2>/dev/null

# 一覧に足すのは、ロックを取ってから（ほかのセッションが足している間は待ち、同じ行を二重に足さない）
LOCK="$LIST.lock"
# ロックを取れずに待ち始めたら、印のファイルを作る（テストは決め打ちで sleep せず、この印ができるまで待つ）
# 印は、一覧のロック（.lock）なら $LOCK_WAIT_MARK、片付けのロック（.lock.reclaim）なら $LOCK_WAIT_MARK.reclaim
cat >"$tmp/lock-wait-mark.cjs" <<'JS'
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const original = fs.mkdirSync
fs.mkdirSync = function (path, ...rest) {
  try {
    return original.call(fs, path, ...rest)
  } catch (error) {
    const name = String(path)
    if (error.code === 'EEXIST' && process.env.LOCK_WAIT_MARK && (name.endsWith('.lock') || name.endsWith('.lock.reclaim'))) {
      fs.writeFileSync(process.env.LOCK_WAIT_MARK + (name.endsWith('.reclaim') ? '.reclaim' : ''), '')
    }
    throw error
  }
}
syncBuiltinESMExports()
JS
MARK="$tmp/lock-wait-mark"
# post_waiting <URL> <tool_use_id>: 開いた後の hook を裏で動かす（ロックを待ち始めたら印を作る）。プロセスの番号を waiter に入れる
post_waiting() {
  rm -f "$MARK" "$MARK.reclaim"
  (post_input "$1" "$2" | NODE_OPTIONS="--require \"$tmp/lock-wait-mark.cjs\"" LOCK_WAIT_MARK="$MARK" bash "$POST" >/dev/null) &
  waiter=$!
}
pre_input 'http://localhost:6440/' toolu_lock_a | bash "$PRE" >/dev/null
mkdir "$LOCK"
post_waiting 'http://localhost:6440/' toolu_lock_a
wait_for "$MARK"
if grep -qx 'http://localhost:6440' "$LIST"; then ng "ロックを取られている間に足した"; else ok; fi
rmdir "$LOCK"
wait "$waiter"
if grep -qx 'http://localhost:6440' "$LIST"; then ok; else ng "ロックが外れた後に足していない"; fi
# ロックを待っている間に、ほかのセッションが同じサイトを足したら、二重に足さない
pre_input 'http://localhost:6441/' toolu_lock_b | bash "$PRE" >/dev/null
mkdir "$LOCK"
post_waiting 'http://localhost:6441/' toolu_lock_b
wait_for "$MARK"
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
post_waiting 'http://localhost:6444/' toolu_lock_reclaim
# 片付けのロックを取ろうとして、取れずに待ち始めるまで待つ
wait_for "$MARK.reclaim"
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

# 持ち主の印を書けないときは、ロックを消してから失敗にする（取れたままのロックを残さない）
cat >"$tmp/owner-fail.cjs" <<'JS'
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const original = fs.writeFileSync
fs.writeFileSync = function (file, ...rest) {
  if (String(file).endsWith('.lock/owner')) {
    const error = new Error('EACCES: permission denied')
    error.code = 'EACCES'
    throw error
  }
  return original.call(fs, file, ...rest)
}
syncBuiltinESMExports()
JS
pre_input 'http://localhost:6449/' toolu_owner_fail | bash "$PRE" >/dev/null
post_input 'http://localhost:6449/' toolu_owner_fail | node --require "$tmp/owner-fail.cjs" "$BIN/lib/playwright-navigate-gate.mjs" post "$HOME/.claude/state" >/dev/null 2>&1
rc=$?
if [ "$rc" = 1 ] && [ ! -e "$LOCK" ] && ! grep -qx 'http://localhost:6449' "$LIST"; then ok; else ng "持ち主の印を書けないときに、ロックを残した・足した・1 で終えない（rc=$rc）"; fi
rm -rf "$LOCK"
# 片付けのロックを取った後に、ほかのセッションが古いロックを片付けて取り直していたら、消さない（片付けのロックの中で、もう一度古いかを確かめる）
# （片付けのロックを作った直後に、古いロックを新しいロック（ほかのセッションの印）に替えて、判断のスクリプトを流す）
cat >"$tmp/reacquire.cjs" <<'JS'
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const original = fs.mkdirSync
fs.mkdirSync = function (path, ...rest) {
  const result = original.call(fs, path, ...rest)
  if (String(path).endsWith('.lock.reclaim')) {
    const lock = String(path).slice(0, -'.reclaim'.length)
    fs.rmSync(lock, { recursive: true, force: true })
    original.call(fs, lock)
    fs.writeFileSync(`${lock}/owner`, 'other-session')
  }
  return result
}
syncBuiltinESMExports()
JS
# ロックを待つ上限（5 秒）まで、実際には待たずに進める（Date.now を、呼ぶたびに 0.5 秒ずつ進むものに差し替える）
# 30 秒より新しいロックを古いとみなさないよう、上限を過ぎるまでに進めるのは数秒だけにする
# 終わるときに、進めた時間（ミリ秒）を $FAST_CLOCK_OUT に書く（待つ上限が hook の timeout の 10 秒に収まるかを確かめるため）
cat >"$tmp/fast-clock.cjs" <<'JS'
const start = Date.now()
let calls = 0
Date.now = () => start + 500 * calls++
process.on('exit', () => {
  if (process.env.FAST_CLOCK_OUT) require('node:fs').writeFileSync(process.env.FAST_CLOCK_OUT, String(500 * calls))
})
JS
CLOCK_OUT="$tmp/fast-clock-out"
pre_input 'http://localhost:6450/' toolu_reacquire | bash "$PRE" >/dev/null
mkdir "$LOCK"
touch -t 202001010000 "$LOCK"
post_input 'http://localhost:6450/' toolu_reacquire | perl -e 'alarm 8; exec @ARGV' node --require "$tmp/fast-clock.cjs" --require "$tmp/reacquire.cjs" "$BIN/lib/playwright-navigate-gate.mjs" post "$HOME/.claude/state" >/dev/null 2>&1
rc=$?
if [ "$rc" = 1 ] && [ "$(cat "$LOCK/owner" 2>/dev/null)" = other-session ] && [ ! -e "$LOCK.reclaim" ] && ! grep -qx 'http://localhost:6450' "$LIST"; then ok; else ng "片付けの間に取り直されたロックを消した・足した（rc=$rc。142 は 8 秒の時間切れ）"; fi
rm -rf "$LOCK" "$LOCK.reclaim"

# 古いロックを消せないとき（ロックがフォルダではなくファイルのときなど）も、待つのは決めた時間までで、理由を伝えて 1 で終える
pre_input 'http://localhost:6443/' toolu_lock_file | bash "$PRE" >/dev/null
rm -rf "$LOCK"
: >"$LOCK"
touch -t 202001010000 "$LOCK"
# 判断のスクリプトを、8 秒の時間切れ（perl の alarm）付きで直接流す（待ち続けても、node ごと止まるように）
rm -f "$CLOCK_OUT"
post_input 'http://localhost:6443/' toolu_lock_file | FAST_CLOCK_OUT="$CLOCK_OUT" perl -e 'alarm 8; exec @ARGV' node --require "$tmp/fast-clock.cjs" "$BIN/lib/playwright-navigate-gate.mjs" post "$HOME/.claude/state" >/dev/null 2>&1
rc=$?
# 進めた時間で、待つのを止めるまでが hook の timeout（10 秒）より短いことを確かめる（上限を長くしすぎると、hook ごと時間切れになるため）
elapsed=$(cat "$CLOCK_OUT" 2>/dev/null || echo none)
if [ "$elapsed" != none ] && [ "$elapsed" -lt 10000 ]; then ok; else ng "古いロックを消せないときに、待つのを止めるまでが 10 秒より長い（進めた時間 $elapsed ミリ秒）"; fi
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
if ls "$STATE" | grep -vE '^(playwright-allowed-origins|playwright-allowed-origins\.flock|playwright-navigate-pending)$' | grep -q .; then ng "書き込みに失敗した一時ファイルが残った（$(ls "$STATE" | tr '\n' ' ')）"; else ok; fi
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
# tabs_input <PreToolUse|PostToolUse> <tool_use_id> <tool_input の JSON> [tool_response の JSON]
tabs_input() { jq -n --arg e "$1" --arg id "$2" --argjson i "$3" --argjson r "${4:-null}" '{hook_event_name: $e, tool_name: "mcp__playwright__browser_tabs", tool_use_id: $id, tool_input: $i} + (if $r == null then {} else {tool_response: $r} end)'; }
# check_tabs <期待> <tool_input の JSON>
check_tabs() {
  local out rc got
  n=$((n + 1))
  out=$(tabs_input PreToolUse "toolu_tabs_$n" "$2" | bash "$PRE")
  rc=$?
  got=$(printf '%s' "$out" | decision_of)
  if [ "$rc" = 0 ] && [ "$got" = "$1" ]; then ok; else ng "browser_tabs $2（期待 $1、結果 $got、rc=$rc）"; fi
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
out=$(tabs_input PostToolUse toolu_tabs_open '{"action": "new", "url": "http://localhost:6302/a"}' '{"content": [{"type": "text", "text": "### Open tabs\n- 0: [Test](http://localhost:6302/a)\n### Page\n- Page URL: http://localhost:6302/a\n"}]}' | bash "$POST")
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
# 決めた PATH には、Apple シリコンと Intel の Mac の、brew の node@24 の場所（ふだんの bin にリンクされない）を入れる
for d in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
  case ":${mcp_path#PATH=}:" in
    *":$d:"* | *":$d\":"* | *":\"$d:"*) ok ;;
    *) ng "決めた PATH に $d がない（$mcp_path）" ;;
  esac
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
# 入口は、受け取った NODE_OPTIONS を node に渡さない（--require で、ほかのコードを読み込ませないように）
for f in "$ENTRY_PRE" "$ENTRY_POST"; do
  name=$(basename "$f")
  unset_line=$(grep -nE '^unset NODE_OPTIONS( |$)' "$f" | head -1)
  source_line=$(grep -nE '^\. ' "$f" | head -1)
  if [ -n "$unset_line" ] && [ "${unset_line%%:*}" -lt "${source_line%%:*}" ]; then ok; else ng "$name で、中身を読む前に NODE_OPTIONS を消していない"; fi
done
# 入口は、受け取った PERL5OPT・PERL5LIB・PERLLIB を perl に渡さない（開いた後の hook は perl を使うため）
for f in "$ENTRY_PRE" "$ENTRY_POST"; do
  name=$(basename "$f")
  unset_line=$(grep -nE '^unset NODE_OPTIONS PERL5OPT PERL5LIB PERLLIB$' "$f" | head -1)
  source_line=$(grep -nE '^\. ' "$f" | head -1)
  if [ -n "$unset_line" ] && [ "${unset_line%%:*}" -lt "${source_line%%:*}" ]; then ok; else ng "$name で、中身を読む前に PERL5OPT・PERL5LIB・PERLLIB を消していない"; fi
done
# （node を探すのは、入口と同じ決めた PATH。playwright-mcp.sh の PATH の行から、外側の引用符を除いて取り出す）
entry_path=${mcp_path#PATH=}
entry_path=${entry_path#\"}
entry_path=${entry_path%\"}
mkdir -p "$tmp/perllib"
printf '%s\n' 'package EvilMark; open(my $f, ">", $ENV{PERL_MARK}); close $f; 1;' >"$tmp/perllib/EvilMark.pm"
rm -f "$tmp/perl-ran"
pre_input 'http://localhost:6472/' toolu_perl5opt | bash "$PRE" >/dev/null
# 入口が perl まで進んだこと（0 で終え、一覧に足した）を確かめてから、読み込ませたモジュールが動いていないことを確かめる
# 決めた PATH に node がないとき（perl まで進まない）は、確かめられないので、合格にも失敗にもしない
if PATH="$entry_path" command -v node >/dev/null 2>&1; then
  post_input 'http://localhost:6472/' toolu_perl5opt | PERL5OPT=-MEvilMark PERL5LIB="$tmp/perllib" PERLLIB="$tmp/perllib" PERL_MARK="$tmp/perl-ran" bash "$ENTRY_POST" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = 0 ] && grep -qx 'http://localhost:6472' "$LIST" && [ ! -e "$tmp/perl-ran" ]; then ok; else ng "開いた後の入口が、受け取った PERL5OPT で読み込ませたモジュールを動かした・perl まで進まなかった（rc=$rc）"; fi
else
  echo "NOTE: 決めた PATH に node がないため、PERL5OPT を渡さないことは確かめていません"
fi
printf '%s\n' "require('node:fs').writeFileSync(process.env.NODE_OPTIONS_MARK, '')" >"$tmp/evil.cjs"
rm -f "$tmp/evil-ran"
pre_input 'http://localhost:5173/' toolu_node_options | NODE_OPTIONS="--require \"$tmp/evil.cjs\"" NODE_OPTIONS_MARK="$tmp/evil-ran" bash "$ENTRY_PRE" >/dev/null 2>&1
post_input 'http://localhost:5173/' toolu_node_options | NODE_OPTIONS="--require \"$tmp/evil.cjs\"" NODE_OPTIONS_MARK="$tmp/evil-ran" bash "$ENTRY_POST" >/dev/null 2>&1
if [ ! -e "$tmp/evil-ran" ]; then ok; else ng "入口が、受け取った NODE_OPTIONS で読み込ませたコードを動かした"; fi

# 入口から中身を正しく呼ぶ（開く前は pre・開いた後は post）。決めた PATH に node があるときは、確かめて開けたサイトを一覧に足す
# node がないとき（CI など）は、開いた後の入口が 1 で終える（どちらの場面でも、どちらかを必ず確かめる）
if PATH="$entry_path" command -v node >/dev/null 2>&1; then
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
