#!/bin/bash
# reply-language-check.sh（managed settings の Stop の hook）のテスト（bash .claude/team/tests/reply-language-check.test.sh）
# 返答の最後のメッセージが英語のときは止めて日本語で書き直させ、日本語の返答・短い返答は止めないことを確かめる
set -u
HOOK="$(cd "$(dirname "$0")/../bin" && pwd)/reply-language-check.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() {
  fail=$((fail + 1))
  printf 'FAIL: %s\n' "$1"
}

# stop_input <返答> [stop_hook_active]
stop_input() {
  jq -n --arg m "$1" --argjson active "${2:-false}" \
    '{hook_event_name: "Stop", session_id: "s", transcript_path: "/nonexistent.jsonl", stop_hook_active: $active, last_assistant_message: $m}'
}
# 判断（block / none）
decision_of() {
  local out
  out=$(cat)
  if [ -z "$out" ]; then echo none; else printf '%s' "$out" | jq -r '.decision // "none"'; fi
}
# check <期待> <説明> <返答> [stop_hook_active]
check() {
  local want=$1 desc=$2 got
  got=$(stop_input "$3" "${4:-false}" | bash "$HOOK" | decision_of)
  if [ "$got" = "$want" ]; then ok; else ng "$desc（期待 $want、結果 $got）"; fi
}

JA='PR #277 のチェックは、全部通りました。CodeRabbit は、PR が Draft なのでまだレビューしていません。マージして入れ直したら、教えてください。'
EN='I opened a draft PR into main. The CI and CodeRabbit checks are still running in the background. When they finish, I will notify you and list any failed checks or review findings.'

# 1. 日本語の返答は止めない
check none '日本語の返答' "$JA"

# 2. 英語の返答は止め、日本語で書き直すよう伝える
check block '英語の返答' "$EN"
out=$(stop_input "$EN" | bash "$HOOK")
if printf '%s' "$out" | jq -r '.reason' | grep -q '日本語で書き直して'; then ok; else ng "止めるときに、日本語で書き直すよう伝えない（$out）"; fi

# 3. 書き直しの途中（stop_hook_active）は、もう一度は止めない（終わらなくならないように）
check none '書き直しの途中の英語の返答' "$EN" true

# 4. 日本語の文に、英語のコード・インラインコード・URL・パス・識別子が多く入っていても止めない
MIXED='変えたファイルは次のとおりです。

```sh
/opt/claude-code-team/bin/github.sh pr create --draft --base main --head fix/playwright-mcp-allow --title "fix: something" --body-file /tmp/body.md
npx vitest run src/components/ui/__tests__/Button.test.tsx --reporter=verbose
```

- `.claude/team/managed-settings.json` の `permissions.ask` から `mcp__playwright__browser_navigate` を外しました
- 詳しくは https://code.claude.com/docs/en/hooks#stop-decision-control と docs/developers/claude-code-sandbox.md を見てください
- テストは `bash .claude/team/tests/managed-settings.test.sh` で流せます'
check none '英語のコード・識別子の多い日本語の返答' "$MIXED"

# 日本語の表に、英語の名前（CI のジョブ名など）が並んでいても止めない
TABLE='| PR | 状態 | 残っていること |
|---|---|---|
| #277 Playwright の navigate・evaluate | Draft、CI はすべて通過（build・backend-test・frontend-test・tdd-order） | マージと install.sh での入れ直し |
| #276 Tailwind の準備 | Draft、CI はすべて通過 | 動作確認の残り 1 か所 |'
check none '英語の名前が並ぶ日本語の表' "$TABLE"

# 5. 英語の返答の中に、日本語のタイトルやパスが少し入っていても止める
EN_WITH_JA='Saved to memory. Two questions for you: should I build the Stop hook, and is it OK to proceed with the plan for 「Playwright の navigate を確かめずに許可する」? The PR title is 「fix: Playwright MCP の browser_navigate と browser_evaluate を確かめずに許可する」.'
check block '日本語のタイトルが少し入った英語の返答' "$EN_WITH_JA"

# 6. 短い返答は止めない（判断できないため）
check none '短い英語の返答' 'OK.'
check none '番号だけの返答' 'PR #277'

# 7. 返答がない・空・文字列でないときは止めない
check none '空の返答' ''
out=$(jq -n '{hook_event_name: "Stop", stop_hook_active: false}' | bash "$HOOK" | decision_of)
if [ "$out" = none ]; then ok; else ng "返答の項目がないときに止めた"; fi
out=$(jq -n '{hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: 123}' | bash "$HOOK" | decision_of)
if [ "$out" = none ]; then ok; else ng "返答が文字列でないときに止めた"; fi

# 8. 入力が壊れているときは止めない（確かめる仕組みが壊れても、作業を止めない）
out=$(printf '%s' '{not json' | bash "$HOOK" 2>/dev/null)
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "壊れた入力で何かを出した・0 で終えない（rc=$rc、$out）"; fi

# 9. node が動かないときは止めない
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/reply-language-check-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
for c in cat dirname; do ln -s "$(command -v "$c")" "$tmp/$c"; done
bash_path=$(command -v bash)
input=$(stop_input "$EN")
out=$(printf '%s' "$input" | PATH="$tmp" "$bash_path" "$HOOK")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "node が動かないときに何かを出した・0 で終えない（rc=$rc、$out）"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
