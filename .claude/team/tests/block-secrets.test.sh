#!/bin/bash
# block-ai-speak-trace-secrets.sh（managed settings の PreToolUse / Bash の hook）のテスト（bash .claude/team/tests/block-secrets.test.sh）
# アプリの API キーが会話ログに出るおそれのあるコマンドを止め、ほかのコマンドは通すことを確かめる
set -u
HOOK="$(cd "$(dirname "$0")/../bin" && pwd)/block-ai-speak-trace-secrets.sh"

pass=0
fail=0
# check <期待（deny / allow）> <コマンド>
check() {
  local want=$1 cmd=$2 got
  if jq -n --arg c "$cmd" '{tool_input: {command: $c}}' | bash "$HOOK" | grep -q '"deny"'; then got=deny; else got=allow; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s（期待 %s、結果 %s）\n' "$cmd" "$want" "$got"
  fi
}

check deny 'cat "$HOME/Library/Application Support/io.github.saicologic.ai-speak-trace/settings.json"'
check deny 'curl -s http://localhost:3000/api/settings'
check deny 'grep anthropicApiKey -r .'
check deny 'echo sk-ant-xxxx'
check allow 'git status'
check allow 'npm test'

# jq が動かないときは、調べられないので止める（exit 2）
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/block-secrets-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
for c in grep cat; do ln -s "$(command -v "$c")" "$tmp/bin/$c"; done
printf '#!/bin/sh\nexit 1\n' >"$tmp/bin/jq"
chmod +x "$tmp/bin/jq"
bash_path=$(command -v bash)
printf '%s' '{"tool_input":{"command":"echo sk-ant-xxxx"}}' | PATH="$tmp/bin" "$bash_path" "$HOOK" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 2 ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: jq が動かないときに止めない（rc=%s）\n' "$rc"
fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
