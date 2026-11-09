#!/bin/bash
# wait-pr-checks.sh のテスト（bash .claude/team/tests/wait-pr-checks.test.sh）
# サンドボックスの外で動くため、決めた形（owner/repo と PR の番号）でない引数は、gh を呼ばずに断ることを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/wait-pr-checks-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
echo called >>"$tmp/gh-called"
EOF
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" WAIT_PR_CHECKS_SETTLE=0

pass=0
fail=0
# rejected <説明> <引数...>
rejected() {
  local name=$1 out rc
  shift
  rm -f "$tmp/gh-called"
  out=$(bash "$BIN/wait-pr-checks.sh" "$@" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && [ ! -e "$tmp/gh-called" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s（rc=%s）: %s\n' "$name" "$rc" "$out"
  fi
}

rejected "引数なし"
rejected "番号なし" owner/repo
rejected "owner/repo の形でない" "a b" 1
rejected "owner/repo に .. を含む" "../x" 1
rejected "番号が数字でない" owner/repo abc
rejected "番号にオプション" owner/repo --web

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
