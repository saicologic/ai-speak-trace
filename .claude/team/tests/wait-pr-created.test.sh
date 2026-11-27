#!/bin/bash
# wait-pr-created.test.sh のテスト（bash .claude/team/tests/wait-pr-created.test.sh）
# サンドボックスの外で動くため、決めた形（owner/repo とブランチ名）でない引数は、gh を呼ばずに使い方を出して断ること、
# 正しい引数なら gh pr list で PR ができるまで待ち、見つけた PR を出すことを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"

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
  out=$(bash "$BIN/wait-pr-created.sh" "$@" 2>&1)
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
out=$(bash "$BIN/wait-pr-created.sh" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" &&
  grep -qx '\[pr\]\[list\]\[-R\]\[o/r\]\[--head\]\[fix/x\]\[--state\]\[all\]\[--json\]\[number,url,title,state,isDraft,baseRefName\]' "$tmp/gh-called" &&
  [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -eq 1 ]; then ok; else ng "PR が最初からある（rc=$rc）: $out / $(cat "$tmp/gh-called" 2>/dev/null)"; fi

# 6. 1回目は空、2回目で見つかる
rm -f "$tmp/gh-called"
printf '%s\n%s\n' '[]' "$FOUND" >"$tmp/answers"
out=$(bash "$BIN/wait-pr-created.sh" o/r feature/a/b 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -eq 2 ]; then ok; else ng "2回目で見つかる（rc=$rc）: $out"; fi

# 7. 見つからないまま時間切れ → TIMEOUT で 0。gh は失敗していないので GH_ERROR を出さない
echo '[]' >"$tmp/answers"
out=$(WAIT_PR_CREATED_TIMEOUT=0 bash "$BIN/wait-pr-created.sh" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && ! printf '%s' "$out" | grep -q '^GH_ERROR:' &&
  ! printf '%s' "$out" | grep -q '^STATUS: FOUND'; then ok; else ng "時間切れ（rc=$rc）: $out"; fi

# 8. gh が失敗し続けて時間切れ → TIMEOUT と、最後の失敗を GH_ERROR で出す
echo 'FAIL' >"$tmp/answers"
out=$(WAIT_PR_CREATED_TIMEOUT=0 bash "$BIN/wait-pr-created.sh" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' &&
  printf '%s' "$out" | grep -qx 'GH_ERROR: HTTP 401: Bad credentials'; then ok; else ng "gh が失敗し続けて時間切れ（rc=$rc）: $out"; fi

# 1回失敗した後に見つかったときは、見つけた PR を出す（失敗は途中で消えた）
printf '%s\n%s\n' 'FAIL' "$FOUND" >"$tmp/answers"
rm -f "$tmp/gh-called"
out=$(bash "$BIN/wait-pr-created.sh" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && ! printf '%s' "$out" | grep -q '^GH_ERROR:'; then ok; else ng "失敗の後に見つかる（rc=$rc）: $out"; fi

# 9. 見張っているプロセスがいるときは、二重に見張らない（ロック名のブランチの / は _ に変える）
echo "$FOUND" >"$tmp/answers"
lock="$tmp/wait-pr-created-o_r-feature_a_b.lock"
mkdir -p "$lock"
echo $$ >"$lock/pid"
rm -f "$tmp/gh-called"
out=$(bash "$BIN/wait-pr-created.sh" o/r feature/a/b 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'ALREADY_WATCHING o/r feature/a/b' && [ ! -e "$tmp/gh-called" ] && [ -d "$lock" ]; then ok; else ng "見張っているプロセスがいる（rc=$rc）: $out"; fi
# 目印（ロック）だけ残っていてプロセスがいないときは、消して見張る。終わったら目印を消す
sh -c 'exit 0' &
dead=$!
wait "$dead"
echo "$dead" >"$lock/pid"
out=$(bash "$BIN/wait-pr-created.sh" o/r feature/a/b 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && [ ! -e "$lock" ]; then ok; else ng "残った目印のあるブランチ（rc=$rc）: $out"; fi
# 見張り終わった後は、目印を残さない
echo '[]' >"$tmp/answers"
WAIT_PR_CREATED_TIMEOUT=0 bash "$BIN/wait-pr-created.sh" o/r fix/x >/dev/null 2>&1
if ! ls "$tmp"/wait-pr-created-*.lock >/dev/null 2>&1; then ok; else ng "時間切れの後に目印が残った"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
