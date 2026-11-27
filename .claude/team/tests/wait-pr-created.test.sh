#!/bin/bash
# wait-pr-created.test.sh のテスト（bash .claude/team/tests/wait-pr-created.test.sh）
# サンドボックスの外で動くため、決めた形（owner/repo とブランチ名）でない引数は、gh を呼ばずに使い方を出して断ること、
# 正しい引数なら gh pr list で PR ができるまで待ち、見つけた PR を出すことを確かめる。
# 入口（bin/wait-pr-created.sh）は PATH を決めた値にしてから中身（bin/lib/wait-pr-created.sh）を読むため、
# 偽の gh・sleep を使う場面は、中身を受け取った PATH のまま動かす。入口は最後の場面で確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
RUN="$BIN/lib/wait-pr-created.sh"

# mktemp が失敗したときは、ここで止める（cd に空の値を渡すと今のフォルダのままになり、終わるときに今のフォルダを消してしまうため）
tmp=$(mktemp -d "${TMPDIR:-/tmp}/wait-pr-created-test.XXXXXX") || exit 1
[ -n "$tmp" ] && [ -d "$tmp" ] || exit 1
tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
# gh の代わり: 呼ばれた引数を1つずつ記録し、answers の行を上から順に答える（行がなくなったら最後の行を繰り返す）。
# 行が FAIL なら、エラーを出して 1 で終わる
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
for a in "\$@"; do printf '[%s]' "\$a"; done >>"$tmp/gh-called"
echo >>"$tmp/gh-called"
n=\$(wc -l <"$tmp/gh-called" | tr -d ' ')
total=\$(wc -l <"$tmp/answers" | tr -d ' ')
[ "\$n" -gt "\$total" ] && n=\$total
line=\$(sed -n "\${n}p" "$tmp/answers")
if [ "\$line" = FAIL ]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi
printf '%s\n' "\$line"
EOF
chmod +x "$tmp/bin/gh"
# sleep の代わり: 待つ秒数を記録して、すぐ終わる（slow があるときだけ 1 秒待つ）。
# 待つ間隔は環境変数で変えられない（外で動くため、0 にして gh を休みなく呼ばせない）ので、テストでは sleep を差し替える
cat >"$tmp/bin/sleep" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >>"$tmp/sleep-called"
if [ -e "$tmp/slow" ]; then /bin/sleep 1; fi
EOF
chmod +x "$tmp/bin/sleep"
# 待つ間隔を 0 にしようとしても、効かないことを確かめるため、わざと渡しておく
export PATH="$tmp/bin:$PATH" WAIT_PR_CREATED_INTERVAL=0 TMPDIR="$tmp"
FOUND='[{"number":12,"url":"https://github.com/o/r/pull/12","title":"t","state":"OPEN","isDraft":true,"baseRefName":"main"}]'

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }
# rejected <説明> <引数...>: 使い方を出して 1 で終わり、gh を呼ばない
rejected() {
  local name=$1 out rc
  shift
  rm -f "$tmp/gh-called"
  echo "$FOUND" >"$tmp/answers"
  out=$(bash "$RUN" "$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '使い方' && [ ! -e "$tmp/gh-called" ]; then ok; else ng "$name（rc=$rc）: $out"; fi
}

# 1. 引数なし・ブランチなし
rejected "引数なし"
rejected "ブランチなし" o/r
# 2. owner/repo の形でない・.. を含む
rejected "owner/repo の形でない" "a b" fix/x
rejected "owner/repo に .. を含む" "../x" fix/x
rejected "repo が .." "o/.." fix/x
# 3. ブランチが決めた頭で始まらない
rejected "ブランチが main" o/r main
rejected "ブランチが foo" o/r foo
rejected "ブランチが頭だけ" o/r fix/
# 4. ブランチに .. ・空白・- で始まる・.lock で終わる・オプション
rejected "ブランチに .. を含む" o/r fix/../x
rejected "ブランチに // を含む" o/r fix//x
rejected "ブランチに空白を含む" o/r "fix/a b"
rejected "ブランチが - で始まる" o/r -fix/x
rejected "ブランチが .lock で終わる" o/r fix/x.lock
rejected "ブランチが --web" o/r --web
rejected "引数が多い" o/r fix/x --web

# found <出力>: 見つけた PR の情報を出している
found() {
  printf '%s' "$1" | grep -qx 'STATUS: FOUND' && printf '%s' "$1" | grep -qx 'PR: https://github.com/o/r/pull/12 t' &&
    printf '%s' "$1" | grep -qx 'NUMBER: 12' && printf '%s' "$1" | grep -qx 'STATE: OPEN' &&
    printf '%s' "$1" | grep -qx 'DRAFT: true' && printf '%s' "$1" | grep -qx 'BASE: main'
}

# 5. PR が最初からある → 見つけた PR を出して 0。-R・--head を別の引数で渡して gh pr list を呼ぶ
rm -f "$tmp/gh-called"
echo "$FOUND" >"$tmp/answers"
out=$(bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" &&
  grep -qx '\[pr\]\[list\]\[-R\]\[o/r\]\[--head\]\[fix/x\]\[--state\]\[all\]\[--json\]\[number,url,title,state,isDraft,baseRefName\]' "$tmp/gh-called" &&
  [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -eq 1 ]; then ok; else ng "PR が最初からある（rc=$rc）: $out / $(cat "$tmp/gh-called" 2>/dev/null)"; fi

# 6. 1回目は空、2回目で見つかる
rm -f "$tmp/gh-called"
printf '%s\n%s\n' '[]' "$FOUND" >"$tmp/answers"
out=$(bash "$RUN" o/r feature/a/b 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -eq 2 ]; then ok; else ng "2回目で見つかる（rc=$rc）: $out"; fi
# 待つ間隔は 60 秒。WAIT_PR_CREATED_INTERVAL=0 を渡しても変わらない
if [ "$(cat "$tmp/sleep-called" 2>/dev/null)" = 60 ]; then ok; else ng "待つ間隔: $(cat "$tmp/sleep-called" 2>/dev/null)"; fi

# 決めた頭のブランチは、どれも見張れる（. を含む release/v1.2.3 も断らない）
for b in test/x release/v1.2.3 dependabot/npm_and_yarn/foo-1.0; do
  echo "$FOUND" >"$tmp/answers"
  rm -f "$tmp/gh-called"
  out=$(bash "$RUN" o/r "$b" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && found "$out"; then ok; else ng "ブランチ $b（rc=$rc）: $out"; fi
done

# 7. 見つからないまま時間切れ → TIMEOUT で 0。gh は失敗していないので GH_ERROR を出さない
echo '[]' >"$tmp/answers"
out=$(WAIT_PR_CREATED_TIMEOUT=0 bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && ! printf '%s' "$out" | grep -q '^GH_ERROR:' &&
  ! printf '%s' "$out" | grep -q '^STATUS: FOUND'; then ok; else ng "時間切れ（rc=$rc）: $out"; fi

# 8. gh が失敗し続けて時間切れ → TIMEOUT と、最後の失敗を GH_ERROR で出す
echo 'FAIL' >"$tmp/answers"
out=$(WAIT_PR_CREATED_TIMEOUT=0 bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' &&
  printf '%s' "$out" | grep -qx 'GH_ERROR: HTTP 401: Bad credentials'; then ok; else ng "gh が失敗し続けて時間切れ（rc=$rc）: $out"; fi

# 1回失敗した後に見つかったときは、見つけた PR を出す（失敗は途中で消えた）
printf '%s\n%s\n' 'FAIL' "$FOUND" >"$tmp/answers"
rm -f "$tmp/gh-called"
out=$(bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && ! printf '%s' "$out" | grep -q '^GH_ERROR:'; then ok; else ng "失敗の後に見つかる（rc=$rc）: $out"; fi

# 1回失敗した後に成功して（PR はまだない）時間切れになったときは、前の失敗を GH_ERROR で出さない
printf '%s\n%s\n' 'FAIL' '[]' >"$tmp/answers"
rm -f "$tmp/gh-called"
touch "$tmp/slow"
out=$(WAIT_PR_CREATED_TIMEOUT=1 bash "$RUN" o/r fix/x 2>&1)
rc=$?
rm -f "$tmp/slow"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && ! printf '%s' "$out" | grep -q '^GH_ERROR:' &&
  [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -ge 2 ]; then ok; else ng "失敗の後に成功して時間切れ（rc=$rc）: $out"; fi

# 9. 見張っているプロセスがいるときは、二重に見張らない
# 目印（ロック）は、見張るプロセスの番号を中身に持つシンボリックリンク。名前は repo とブランチのハッシュ（長さを決めるため）
lockname() { printf '%s\n%s' "$1" "$2" | shasum -a 256 | cut -c1-32; }
lock="$tmp/wait-pr-created-$(lockname o/r feature/a/b).lock"
echo "$FOUND" >"$tmp/answers"
ln -s "$$" "$lock"
rm -f "$tmp/gh-called"
out=$(bash "$RUN" o/r feature/a/b 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'ALREADY_WATCHING o/r feature/a/b' && [ ! -e "$tmp/gh-called" ] &&
  [ "$(readlink "$lock")" = "$$" ]; then ok; else ng "見張っているプロセスがいる（rc=$rc）: $out"; fi
rm -f "$lock"
# 目印だけ残っていてプロセスがいない・中身が数字でない・前の形（フォルダ）の目印が残っているときは、消して見張る。終わったら目印を消す
sh -c 'exit 0' &
dead=$!
wait "$dead"
for content in "$dead" abc dir; do
  echo "$FOUND" >"$tmp/answers"
  if [ "$content" = dir ]; then mkdir -p "$lock"; echo "$dead" >"$lock/pid"; else ln -s "$content" "$lock"; fi
  out=$(bash "$RUN" o/r feature/a/b 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && found "$out" && [ ! -e "$lock" ] && [ ! -L "$lock" ]; then ok; else ng "残った目印 $content（rc=$rc）: $out"; fi
  rm -rf "$lock"
done

# 見張っている間は、目印が自分の番号を指す。終わるときは、自分の番号の目印だけを消す
# （別のプロセスが目印を取り直していたら、それを消さない）
echo '[]' >"$tmp/answers"
touch "$tmp/slow"
WAIT_PR_CREATED_TIMEOUT=3 bash "$RUN" o/r fix/a/b >/dev/null 2>&1 &
bg=$!
bglock="$tmp/wait-pr-created-$(lockname o/r fix/a/b).lock"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -L "$bglock" ] && break
  /bin/sleep 0.2
done
if [ "$(readlink "$bglock" 2>/dev/null)" = "$bg" ] && kill -0 "$bg" 2>/dev/null; then ok; else ng "見張っている間の目印: $(readlink "$bglock" 2>&1)"; fi
# / と _ の違うブランチは、別の目印にする（fix/a/b を見張っている間も、fix/a_b は見張れる）
if [ -L "$bglock" ] && kill -0 "$bg" 2>/dev/null; then
  echo "$FOUND" >"$tmp/answers"
  out=$(bash "$RUN" o/r fix/a_b 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && found "$out"; then ok; else ng "/ と _ の違うブランチ（rc=$rc）: $out"; fi
  echo '[]' >"$tmp/answers"
else
  ng "/ と _ の違うブランチ: 後ろで fix/a/b を見張れていない"
fi
# 別のプロセスが目印を取り直した形にして、後ろの側が終わるのを待つ
rm -f "$bglock"
ln -s "$$" "$bglock"
wait "$bg"
rm -f "$tmp/slow"
if [ "$(readlink "$bglock" 2>/dev/null)" = "$$" ]; then ok; else ng "別のプロセスの目印を消した"; fi
rm -f "$bglock"

# とても長いブランチ名でも、目印を作って見張れる（名前の長さの上限を超えない）
long="feature/$(printf 'a%.0s' $(seq 1 240))"
echo "$FOUND" >"$tmp/answers"
out=$(bash "$RUN" o/r "$long" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out"; then ok; else ng "長いブランチ名（rc=$rc）: $out"; fi
# 目印を作れない（置き場所がない）ときは、ALREADY_WATCHING と取り違えず、エラーで 1 を返す
rm -f "$tmp/gh-called"
out=$(TMPDIR="$tmp/nodir" bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 1 ] && ! printf '%s' "$out" | grep -q 'ALREADY_WATCHING' && printf '%s' "$out" | grep -q '目印を作れません' &&
  [ ! -e "$tmp/gh-called" ]; then ok; else ng "目印を作れない（rc=$rc）: $out"; fi

# 見張り終わった後は、目印を残さない
echo '[]' >"$tmp/answers"
WAIT_PR_CREATED_TIMEOUT=0 bash "$RUN" o/r fix/x >/dev/null 2>&1
if ! ls "$tmp"/wait-pr-created-*.lock >/dev/null 2>&1; then ok; else ng "時間切れの後に目印が残った"; fi

# 10. 入口は、受け取った PATH を使わない（作業ツリーなどに置いた gh・jq を、サンドボックスの外で動かさない）。
# playwright-mcp.sh と同じ決めた PATH にしてから、中身を読む
entry="$BIN/wait-pr-created.sh"
mcp_path=$(grep -E '^PATH="?/' "$BIN/playwright-mcp.sh")
path_line=$(grep -nE '^PATH="?/' "$entry" | head -1)
source_line=$(grep -nE '^\. .*lib/wait-pr-created\.sh' "$entry" | head -1)
if [ -n "$mcp_path" ] && [ "${path_line#*:}" = "$mcp_path" ]; then ok; else ng "入口の PATH が playwright-mcp.sh と同じでない（${path_line#*:}）"; fi
if [ -n "$path_line" ] && [ -n "$source_line" ] && [ "${path_line%%:*}" -lt "${source_line%%:*}" ] &&
  grep -qx 'export PATH' "$entry"; then ok; else ng "入口で、中身を読む前に PATH を決めていない"; fi
# 入口でも、引数の形を確かめる（中身に渡る）。偽の gh を PATH の前に置いても、断るときは何も呼ばない
rm -f "$tmp/gh-called"
out=$(bash "$entry" o/r main 2>&1)
rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '使い方' && [ ! -e "$tmp/gh-called" ]; then ok; else ng "入口で引数を断る（rc=$rc）: $out"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
