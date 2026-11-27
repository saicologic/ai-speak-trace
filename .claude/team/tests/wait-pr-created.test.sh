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
mkdir -p "$tmp/bin" "$tmp/scratch"
# gh の代わり: 呼ばれた引数を1つずつ記録し、answers の行を上から順に答える（行がなくなったら最後の行を繰り返す）。
# 行が FAIL なら、エラーを出して 1 で終わる。HANG なら、何も答えずに 30 秒止まる（exec で、子のプロセスを残さない）
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
for a in "\$@"; do printf '[%s]' "\$a"; done >>"$tmp/gh-called"
echo >>"$tmp/gh-called"
# 呼ばれている間に、中身に渡した TMPDIR（テストの答えとは別のフォルダ）に何かあれば記録する
if [ -n "\$(ls -A "\${TMPDIR:-/nonexistent}" 2>/dev/null)" ]; then ls -A "\$TMPDIR" >>"$tmp/tmpfile-seen"; fi
n=\$(wc -l <"$tmp/gh-called" | tr -d ' ')
total=\$(wc -l <"$tmp/answers" | tr -d ' ')
[ "\$n" -gt "\$total" ] && n=\$total
line=\$(sed -n "\${n}p" "$tmp/answers")
if [ "\$line" = FAIL ]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi
if [ "\$line" = HANG ]; then exec /bin/sleep 30; fi
printf '%s\n' "\$line"
EOF
chmod +x "$tmp/bin/gh"
# sleep の代わり: 待つ秒数を記録して、すぐ終わる（slow があるときは 1 秒、realsleep があるときは渡された秒数だけ待つ）。
# 待つ間隔は環境変数で変えられない（外で動くため、0 にして gh を休みなく呼ばせない）ので、テストでは sleep を差し替える
cat >"$tmp/bin/sleep" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >>"$tmp/sleep-called"
if [ -e "$tmp/realsleep" ]; then /bin/sleep "\$1"; elif [ -e "$tmp/slow" ]; then /bin/sleep 1; fi
EOF
chmod +x "$tmp/bin/sleep"
# 待つ間隔を 0 にしようとしても、効かないことを確かめるため、わざと渡しておく
# 中身の TMPDIR は、テストの答えとは別の空のフォルダにする（中身が何も作らないことを確かめるため）
export PATH="$tmp/bin:$PATH" WAIT_PR_CREATED_INTERVAL=0 TMPDIR="$tmp/scratch"
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
# git で作れないブランチ名（/ で終わる・. で終わる・. で始まる部分・.lock で終わる部分）
rejected "ブランチが / で終わる" o/r fix/x/
rejected "ブランチが . で終わる" o/r fix/x.
rejected "ブランチの部分が . で始まる" o/r fix/.x
rejected "ブランチの途中の部分が .lock で終わる" o/r fix/a.lock/x
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
# gh の出力・エラーは、TMPDIR の一時ファイルを通さずに受け取る（TMPDIR はサンドボックスの中から書けるため、
# 作った後に名前をリンクに差し替えられると、サンドボックスの外のファイルに書いてしまう）。目印（ロック）も作らない
if [ ! -e "$tmp/tmpfile-seen" ] && [ -z "$(ls -A "$tmp/scratch")" ]; then ok; else ng "TMPDIR にファイルを作った: $(cat "$tmp/tmpfile-seen" 2>/dev/null) $(ls -A "$tmp/scratch")"; fi
# here-string（<<<）・here-document（<<）は bash 3.2 で TMPDIR に一時ファイルを作るため、中身で使わない（コメントは除く）
if ! grep -v '^[[:space:]]*#' "$RUN" | grep -qE '<<'; then ok; else ng "中身で <<< か << を使っている: $(grep -nv '^[[:space:]]*#' "$RUN" | grep -E '<<')"; fi

# 1回失敗した後に見つかったときは、見つけた PR を出す（失敗は途中で消えた）
printf '%s\n%s\n' 'FAIL' "$FOUND" >"$tmp/answers"
rm -f "$tmp/gh-called"
out=$(bash "$RUN" o/r fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && ! printf '%s' "$out" | grep -q '^GH_ERROR:'; then ok; else ng "失敗の後に見つかる（rc=$rc）: $out"; fi

# 時間切れが近いときは、残り時間より長く待たない（WAIT_PR_CREATED_TIMEOUT=3 で、60 秒待たない）。
# 偽の sleep は渡された秒数だけ本当に待つので、1回目の gh が遅くても、待つ秒数は残り時間以下になる
echo '[]' >"$tmp/answers"
rm -f "$tmp/sleep-called"
touch "$tmp/realsleep"
out=$(WAIT_PR_CREATED_TIMEOUT=3 bash "$RUN" o/r fix/x 2>&1)
rm -f "$tmp/realsleep"
waits=$(tr '\n' ' ' <"$tmp/sleep-called" 2>/dev/null)
if printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && [ -n "$waits" ] &&
  ! awk '$1 > 3 || $1 < 1 { bad = 1 } END { exit !bad }' "$tmp/sleep-called" 2>/dev/null; then ok; else ng "残り時間より長く待った（待った秒数: $waits）: $out"; fi
# 先頭が 0 の秒数（08）も 10 進数として読む（8 進数として読んで、計算のエラーで止まらない）
printf '%s\n%s\n' '[]' "$FOUND" >"$tmp/answers"
rm -f "$tmp/sleep-called" "$tmp/gh-called"
out=$(WAIT_PR_CREATED_TIMEOUT=08 bash "$RUN" o/r fix/x 2>&1)
rc=$?
# 1回目の gh の間に秒の境目をまたぐと、残りは 7 秒になる。8 進数のエラーでもなく、いつもの 60 秒でもないことを確かめる
w=$(cat "$tmp/sleep-called" 2>/dev/null)
if [ "$rc" -eq 0 ] && found "$out" && { [ "$w" = 8 ] || [ "$w" = 7 ]; }; then ok; else ng "WAIT_PR_CREATED_TIMEOUT=08（rc=$rc）: $out / 待った秒数: $(cat "$tmp/sleep-called" 2>/dev/null)"; fi

# 1回失敗した後に成功して（PR はまだない）時間切れになったときは、前の失敗を GH_ERROR で出さない
# 偽の sleep が残り時間だけ本当に待つので、2回目の gh（成功）の後に時間切れになる
printf '%s\n%s\n' 'FAIL' '[]' >"$tmp/answers"
rm -f "$tmp/gh-called"
touch "$tmp/realsleep"
out=$(WAIT_PR_CREATED_TIMEOUT=3 bash "$RUN" o/r fix/x 2>&1)
rc=$?
rm -f "$tmp/realsleep"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && ! printf '%s' "$out" | grep -q '^GH_ERROR:' &&
  [ "$(wc -l <"$tmp/gh-called" | tr -d ' ')" -ge 2 ]; then ok; else ng "失敗の後に成功して時間切れ（rc=$rc）: $out"; fi

# gh が答えないまま時間切れになったら、gh を止めて TIMEOUT を返す（gh を待ち続けない）
echo 'HANG' >"$tmp/answers"
rm -f "$tmp/gh-called"
t0=$SECONDS
out=$(WAIT_PR_CREATED_TIMEOUT=2 bash "$RUN" o/r fix/x 2>&1)
rc=$?
took=$((SECONDS - t0))
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && printf '%s' "$out" | grep -q '^GH_ERROR: .*時間内に終わりませんでした' &&
  [ "$took" -lt 20 ]; then ok; else ng "gh が答えない（rc=$rc、${took} 秒）: $out"; fi

# gh の答えが JSON でない・形が違う（PR の情報を出せない）ときは、PR がないのと区別して GH_ERROR を出す。FOUND は出さない
for bad in 'not json' '[1]' '{"a":1}'; do
  echo "$bad" >"$tmp/answers"
  out=$(WAIT_PR_CREATED_TIMEOUT=0 bash "$RUN" o/r fix/x 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qx 'STATUS: TIMEOUT' && printf '%s' "$out" | grep -q '^GH_ERROR: .*答えを読めません' &&
    ! printf '%s' "$out" | grep -q 'STATUS: FOUND'; then ok; else ng "gh の答えが $bad（rc=$rc）: $out"; fi
done

# 9. 同じブランチを二重に見張っても止めない（目印を作らない）。とても長いブランチ名でも見張れる
long="feature/$(printf 'a%.0s' $(seq 1 240))"
echo "$FOUND" >"$tmp/answers"
out=$(bash "$RUN" o/r "$long" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && found "$out" && ! printf '%s' "$out" | grep -q 'ALREADY_WATCHING' && [ -z "$(ls -A "$tmp/scratch")" ]; then ok; else ng "長いブランチ名（rc=$rc）: $out"; fi

# 10. 入口は、受け取った環境を中身に渡さない（作業ツリーなどに置いた gh・jq、PERL5OPT・exported function などで、
# サンドボックスの外の処理を動かさせない）。PATH は playwright-mcp.sh と同じ決めた値にし、env -i で中身を動かす
entry="$BIN/wait-pr-created.sh"
mcp_path=$(grep -E '^PATH="?/' "$BIN/playwright-mcp.sh")
path_lines=$(grep -cE '^PATH=' "$entry")
path_line=$(grep -E '^PATH="?/' "$entry" | head -1)
if [ -n "$mcp_path" ] && [ "$path_line" = "$mcp_path" ] && [ "$path_lines" -eq 1 ]; then ok; else ng "入口の PATH が playwright-mcp.sh と同じでない（$path_line）"; fi
if grep -qE '^exec /usr/bin/env -i .*/bin/bash --noprofile --norc "\$lib" "\$@"$' "$entry"; then ok; else ng "入口で、env -i を通して中身を動かしていない"; fi
# 入口を写し、受け取った環境を書き出すだけの偽の中身と並べて動かす（入口は、自分の隣の lib/ を読む）
mkdir -p "$tmp/entry/lib"
cp "$entry" "$tmp/entry/wait-pr-created.sh"
cat >"$tmp/entry/lib/wait-pr-created.sh" <<EOF
printf 'ARGS:'; printf '[%s]' "\$@"; echo
# Perl のスクリプト（shasum）を1回動かし、受け取った PERL5OPT で Perl のコードが動かないことを確かめる
shasum -a 256 </dev/null >/dev/null
env | LC_ALL=C sort
declare -F
pwd
EOF
mkdir -p "$tmp/perl"
cat >"$tmp/perl/Evil.pm" <<EOF
package Evil; open(my \$f, '>', '$tmp/perl-ran'); 1;
EOF
# 入口は、excludedCommands のとおりパスを書いて直接動かす（shebang が効く形）。
# 入口そのものも、受け取った BASH_ENV を読まず、exported function（exec・gh の上書き）を取り込まない
printf 'touch "%s/bashenv-ran"\n' "$tmp" >"$tmp/bashenv"
chmod +x "$tmp/entry/wait-pr-created.sh"
gh() { echo evil; }
exec() { echo HIJACKED; }
export -f gh exec
out=$(cd "$tmp" && PERL5OPT=-MEvil PERL5LIB="$tmp/perl" NODE_OPTIONS=--require=x BASH_ENV="$tmp/bashenv" GH_TOKEN=leak \
  HOME="$tmp/fakehome" WAIT_PR_CREATED_TIMEOUT=5 "$tmp/entry/wait-pr-created.sh" o/r "fix/a b" 2>&1)
unset -f gh exec
if [ ! -e "$tmp/bashenv-ran" ]; then ok; else ng "入口が受け取った BASH_ENV を読んだ"; fi
if ! printf '%s' "$out" | grep -q 'HIJACKED'; then ok; else ng "入口が exported function の exec を使った: $out"; fi
# HOME は受け取った値ではなく、アカウントの情報から求める（gh の設定の場所を差し替えさせない）
if printf '%s' "$out" | grep -q '^HOME=/' && ! printf '%s' "$out" | grep -qxF "HOME=$tmp/fakehome"; then ok; else ng "受け取った HOME を中身に渡した: $out"; fi
want_path="${mcp_path#PATH=}"
want_path="${want_path//\"/}"
if printf '%s' "$out" | grep -qxF 'ARGS:[o/r][fix/a b]'; then ok; else ng "入口が引数をそのまま渡していない: $out"; fi
if printf '%s' "$out" | grep -qxF "PATH=$want_path"; then ok; else ng "中身の PATH が決めた値でない: $out"; fi
if printf '%s' "$out" | grep -qx 'WAIT_PR_CREATED_TIMEOUT=5' && printf '%s' "$out" | grep -q '^HOME=/'; then ok; else ng "中身に WAIT_PR_CREATED_TIMEOUT・HOME を渡していない: $out"; fi
# 中身は TMPDIR を使わないので、受け取った TMPDIR も渡さない
if ! printf '%s' "$out" | grep -q '^TMPDIR='; then ok; else ng "中身に TMPDIR を渡した: $out"; fi
if ! printf '%s' "$out" | grep -qE '^(PERL5OPT|PERL5LIB|NODE_OPTIONS|BASH_ENV|GH_TOKEN|BASH_FUNC_)' &&
  ! printf '%s' "$out" | grep -q 'declare -f'; then ok; else ng "受け取った環境が中身に渡った: $out"; fi
if printf '%s' "$out" | grep -qx '/'; then ok; else ng "中身を / で動かしていない: $out"; fi
# 入口が呼ぶコマンドで Perl が動いても、受け取った PERL5OPT を使わない
if [ ! -e "$tmp/perl-ran" ]; then ok; else ng "受け取った PERL5OPT で Perl のコードが動いた"; fi
# 本物の中身でも、入口から引数を断る（断るときは gh を呼ばない）
rm -f "$tmp/gh-called"
out=$("$entry" o/r main 2>&1)
rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '使い方' && [ ! -e "$tmp/gh-called" ]; then ok; else ng "入口で引数を断る（rc=$rc）: $out"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
