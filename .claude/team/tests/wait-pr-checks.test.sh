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
  "pr view") if [ -e "${tmp}/prview-fail" ]; then echo '{}'; else echo '{"headRefOid":"abc","url":"https://github.com/o/r/pull/1","title":"t","isDraft":true}'; fi ;;
  "api repos/o/r/commits/abc/status") if [ -e "${tmp}/status-fail" ]; then exit 1; fi; echo "success	Review skipped" ;;
  "api graphql") cat "$tmp/graphql" 2>/dev/null || echo '{}' ;;
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
# 指摘を調べられなかった（GraphQL の答えが壊れている）ときは、0 件ではなく unknown と出す
if printf '%s' "$out" | grep -qx 'CODERABBIT_OPEN_COMMENTS: unknown' && printf '%s' "$out" | grep -qx 'CODERABBIT_RESOLVED_COMMENTS: unknown'; then ok; else ng "指摘を調べられないときの件数: $out"; fi

# 指摘を調べられたときは件数を出す。100 件より多く、全部は読めなかったときは、そのことも出す
cat >"$tmp/graphql" <<'EOF'
{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":true},"nodes":[
  {"isResolved":false,"path":"a.ts","line":3,"originalLine":3,"comments":{"nodes":[{"author":{"login":"coderabbitai"},"body":"_🟠 Major_\n\n**見出し**\n\n本文"}]}},
  {"isResolved":true,"path":"b.ts","line":1,"originalLine":1,"comments":{"nodes":[{"author":{"login":"coderabbitai"},"body":"_🟡 Minor_\n\n**別の見出し**"}]}}
]}}}}}
EOF
out=$(bash "$BIN/wait-pr-checks.sh" o/r 1 2>&1)
if printf '%s' "$out" | grep -qx 'CODERABBIT_OPEN_COMMENTS: 1' && printf '%s' "$out" | grep -qx 'CODERABBIT_RESOLVED_COMMENTS: 1' &&
  printf '%s' "$out" | grep -qF '[🟠 Major] 見出し (a.ts:3)' && printf '%s' "$out" | grep -qx 'CODERABBIT_THREADS_TRUNCATED: true'; then ok; else ng "指摘の件数: $out"; fi

# PR の情報を取れなかったときは、CodeRabbit の状態を none（レビュー待ち）ではなく unknown と出す
touch "$tmp/prview-fail"
out=$(bash "$BIN/wait-pr-checks.sh" o/r 1 2>&1)
if printf '%s' "$out" | grep -q '^CODERABBIT: unknown'; then ok; else ng "PR の情報を取れないときの CodeRabbit の状態: $out"; fi
rm -f "$tmp/prview-fail"

# CodeRabbit の状態の API が失敗したときも、none（レビュー待ち）ではなく unknown と出す
touch "$tmp/status-fail"
out=$(bash "$BIN/wait-pr-checks.sh" o/r 1 2>&1)
if printf '%s' "$out" | grep -q '^CODERABBIT: unknown'; then ok; else ng "状態の API が失敗したときの CodeRabbit の状態: $out"; fi
rm -f "$tmp/status-fail"

# 指摘の一覧を作れなかった（jq が失敗した）ときは、0 件ではなく unknown と出す
cat >"$tmp/graphql" <<'EOF'
{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[
  {"isResolved":false,"path":"a.ts","line":3,"comments":{"nodes":[{"author":{"login":"coderabbitai"},"body":1}]}}
]}}}}}
EOF
out=$(bash "$BIN/wait-pr-checks.sh" o/r 1 2>&1)
if printf '%s' "$out" | grep -qx 'CODERABBIT_OPEN_COMMENTS: unknown'; then ok; else ng "指摘の一覧を作れないときの件数: $out"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
