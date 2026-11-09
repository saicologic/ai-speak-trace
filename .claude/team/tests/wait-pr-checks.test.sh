#!/bin/bash
# wait-pr-checks.sh のテスト（bash .claude/team/tests/wait-pr-checks.test.sh）
# サンドボックスの外で動くため、決めた形（owner/repo と PR の番号）でない引数は、gh を呼ばずに使い方を出して断ること、
# 正しい引数なら gh でチェックの結果を調べて出すことを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/wait-pr-checks-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
# gh の代わり: 呼ばれた引数を記録し、チェックはすべて終わった（pass）と答える
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >>"$tmp/gh-called"
case "\$1 \$2" in
  "pr checks")
    if [[ " \$* " == *" --jq "* ]]; then echo "  build: pass"; else echo '[{"name":"build","bucket":"pass"}]'; fi ;;
  "pr view") echo '{"headRefOid":"abc","url":"https://github.com/o/r/pull/1","title":"t","isDraft":true}' ;;
  "api repos/o/r/commits/abc/status") echo "success	Review skipped" ;;
  *) echo '{}' ;;
esac
EOF
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" WAIT_PR_CHECKS_SETTLE=0 TMPDIR="$tmp"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }
# rejected <説明> <引数...>: 使い方を出して 1 で終わり、gh を呼ばない
rejected() {
  local name=$1 out rc
  shift
  rm -f "$tmp/gh-called"
  out=$(bash "$BIN/wait-pr-checks.sh" "$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '使い方' && [ ! -e "$tmp/gh-called" ]; then ok; else ng "$name（rc=$rc）: $out"; fi
}

rejected "引数なし"
rejected "番号なし" o/r
rejected "owner/repo の形でない" "a b" 1
rejected "owner/repo に .. を含む" "../x" 1
rejected "repo が .." "o/.." 1
rejected "番号が数字でない" o/r abc
rejected "番号にオプション" o/r --web

# 正しい引数なら、チェックが終わるのを待ち、結果を出す
rm -f "$tmp/gh-called"
out=$(bash "$BIN/wait-pr-checks.sh" o/r 1 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q '^STATUS: DONE' && printf '%s' "$out" | grep -q '^CODERABBIT: skipped' &&
  grep -q '^pr checks 1 -R o/r' "$tmp/gh-called"; then ok; else ng "正しい引数（rc=$rc）: $out"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
