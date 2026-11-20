#!/bin/bash
# reply-language-check.sh（managed settings の Stop の hook）のテスト（bash .claude/team/tests/reply-language-check.test.sh）
# 返答の最後のメッセージが英語のときは止めて日本語で書き直させ、日本語の返答・短い返答は止めないことを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
HOOK="$BIN/reply-language-check.sh"

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
# expect_result <期待（block / none）> <説明> <入力の JSON>
# none: 何も出さず 0 で終える。block: decision が block の JSON を出して 0 で終える
expect_result() {
  local want=$1 desc=$2 out rc
  out=$(printf '%s' "$3" | bash "$HOOK")
  rc=$?
  if [ "$rc" != 0 ]; then
    ng "$desc（終了コード $rc）"
  elif [ "$want" = none ]; then
    if [ -z "$out" ]; then ok; else ng "$desc（期待 none、出力 $out）"; fi
  else
    if [ "$(printf '%s' "$out" | jq -r '.decision // empty' 2>/dev/null)" = block ]; then ok; else ng "$desc（期待 block、出力 $out）"; fi
  fi
}
# check <期待> <説明> <返答> [stop_hook_active]
check() {
  local json
  json=$(stop_input "$3" "${4:-false}") && [ -n "$json" ] || {
    ng "$2（テストの入力を作れなかった）"
    return
  }
  expect_result "$1" "$2" "$json"
}
# 英字だけの文字列（n 文字）・日本語だけの文字列（n 文字）
latin() { printf 'a%.0s' $(seq 1 "$1"); }
kana() { printf 'あ%.0s' $(seq 1 "$1"); }

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

# 4. 言語の判断に関係しない部分は数えない（どれも、数えると英字が多くなり止まる量にしてある）
LONG_EN='npx vitest run src/components/ui/Button.test.tsx --reporter verbose --coverage'
check none 'バッククォートのコードブロック' "実行例です。
\`\`\`sh
$LONG_EN
\`\`\`"
check none 'チルダのコードブロック' "実行例です。
~~~sh
$LONG_EN
~~~"
check none 'インラインコード' "実行例です。\`$LONG_EN\`"
check none '中にバッククォートのある、二重のバッククォートのインラインコード' "実行例です。\`\`echo \`date\` && $LONG_EN\`\`"
check none '引用の行（英語の指摘・ログ）' "指摘は次のとおりです。
> Please verify the exit code before extracting the decision in every case.
> Treat parenthesized file paths as path boundaries as well."
check none 'URL' "詳しくはここです。https://code.claude.com/docs/en/hooks#stop-decision-control-and-examples"
check none 'メールアドレス' "連絡先です。notifications-for-the-team-members@example-company.example.com"
check none '空白の後のパス' "変えました。 .claude/team/bin/reply-language-check.sh .claude/team/bin/lib/reply-language-check.mjs"
check none '日本語・かっこのすぐ後のパス' '次のファイルを変えました（.claude/team/bin/reply-language-check.sh・.claude/team/bin/lib/reply-language-check.mjs・.claude/team/managed-settings.json・backend/src/lint/claude-team-tools.spec.ts）。'
check none '半角のかっこの中のパス' '参照先です。(backend/src/guardrails/guardrails-policy-validation.service.ts)'
check none '字下げしたチルダのコードブロック' "実行例です。
  ~~~
  $LONG_EN
  ~~~"
check none '4 つ以上の空白で字下げした、空の行のあるコードブロック' "実行例です。
     \`\`\`bash
     $LONG_EN

     $LONG_EN
     \`\`\`"
check none '閉じのないコードブロック（最後まで）' "実行例です。
~~~
$LONG_EN
$LONG_EN"
check none '別の記号の混ざった行では閉じないコードブロック' "実行例です。
~~~
~~~\`
$LONG_EN
~~~"
# 箇条書きの中で始まるコードブロックも除き、閉じた後の文は残す
# （コードを数えると止まる。閉じた後の日本語を消したときは、下の block のテストで気づく）
check none '箇条書きの中のコードブロックと、閉じた後の日本語' "- 実行例です。
- ~~~text
  $LONG_EN
  ~~~
$(kana 10)$(latin 40)"
# チルダにするのは、バッククォートだとインラインコードの処理でも消えて、確かめられないため
check none '番号付きの箇条書きの中のコードブロック' "1. 実行例です。
2. ~~~bash
   $LONG_EN
   ~~~"
# 箇条書きの記号ごとに、閉じた後の英語の文を最後まで除かない（閉じを開きと読み違えると、後の文が消えて止まらない）
for marker in '-' '*' '+' '1.' '1)'; do
  check block "箇条書き（$marker）の中のコードブロックが閉じた後の英語の文（最後まで除かない）" "$marker ~~~text
  echo
  ~~~
$EN"
done
# ~~~ の開きの行には、バッククォートがあってもよい（CommonMark と同じ）
check none '開きの行にバッククォートのあるチルダのコードブロック' "実行例です。
~~~js \`x\`
$LONG_EN
~~~"
# 行の頭のインラインコードは、コードブロックの開きとみなさない（後の英語の文を消さない）
check block '箇条書きの頭のインラインコードの後の英語の文' "1. \`\`\`npm test\`\`\` を流す。
$EN"
check block '行の頭のインラインコードの後の英語の文' "\`\`\`npm test\`\`\` を流す。
$EN"
# / を含む並びは、パス・ブランチの名前とみなして除く（種類ごとに、除かなければ止まる量にしてある）
check none '/・~ で始まる並び' '場所です。 ~/Library/Caches /opt/claude-code-team /usr/local/bin ~/.claude/state'
check none '/ が 2 つ以上で拡張子のない並び' '場所です。 backend/src/lint frontend/src/components .claude/team/tests'
check none '/ が 1 つで拡張子のある並び' '場所です。 docs/ai-testing.md backend/package.json scripts/dev.mjs'
check none '/ が 1 つで拡張子のないブランチ・フォルダの名前' '対象のブランチとフォルダ: fix/japanese-reply-check・feature/tailwind-setup・backend/src・frontend/src・docs/developers'
check none '/ のないファイルの名前' '更新しました。 reply-language-check.mjs managed-settings.test.sh claude-team-tools.spec.ts'
check none '+ を含むパス' 'ログの場所です。 /tmp/build+releasecandidate /opt/cache+temporaryfiles /var/log+previousruns'
# + を含むパスのすぐ後の日本語は消さない（日本語 10 文字・英字 40 文字の 2 割ちょうど。+ の後を数えても、日本語を消しても止まる）
check none '+ を含むパスのすぐ後に続く日本語' "/tmp/build+x$(kana 10) $(latin 40)"
# URL のすぐ後に続く日本語は、URL と一緒に消さない
check none 'URL のすぐ後に続く日本語' "見てくださいhttps://x.example/aaを$(kana 16) Run these steps carefully please now ok then"

# 日本語の表に、英語の名前（CI のジョブ名など）が並んでいても止めない
TABLE='| PR | 状態 | 残っていること |
|---|---|---|
| #277 Playwright の navigate・evaluate | Draft、CI はすべて通過（build・backend-test・frontend-test・tdd-order） | マージと install.sh での入れ直し |
| #276 Tailwind の準備 | Draft、CI はすべて通過 | 動作確認の残り 1 か所 |'
check none '英語の名前が並ぶ日本語の表' "$TABLE"

# 除く処理が、英語の文まで消さないこと
check block '対になっていないバッククォートの後の英語の文（段落をまたいでインラインコードにしない）' 'The template literal opening (`) was not closed.

I fixed the parser, updated the tests, and verified the build passes on CI. Then I ran `npm test`.'
check block 'バッククォートの数が開きと閉じで違う英語の文' '``The release notes were updated and every check passed on the main branch today.`'
check block '引用の間の英語の段落' '> note `

This English paragraph explains everything that changed in the build today.

> end `'
check block '引用の行のすぐ間の英語の行（引用を先に除くので、インラインコードにしない）' '> note `
This English line explains everything that changed in the build today and more.
> end `'

# 5. 英語の返答の中に、日本語のタイトルやパスが少し入っていても止める
EN_WITH_JA='Saved to memory. Two questions for you: should I build the Stop hook, and is it OK to proceed with the plan for 「Playwright の navigate を確かめずに許可する」? The PR title is 「fix: Playwright MCP の browser_navigate と browser_evaluate を確かめずに許可する」.'
check block '日本語のタイトルが少し入った英語の返答' "$EN_WITH_JA"

# 6. 短い返答は止めない（判断に使う文字が 40 文字より少ないとき）。境目も確かめる
check none '短い英語の返答' 'OK.'
check none '番号だけの返答' 'PR #277'
check none '英字 39 文字' "$(latin 39)"
check block '英字 40 文字' "$(latin 40)"
# 日本語の割合が 2 割ちょうどなら止めず、2 割より少なければ止める
check none '日本語 8 文字・英字 32 文字（2 割ちょうど）' "$(kana 8)$(latin 32)"
check block '日本語 7 文字・英字 33 文字（2 割より少ない）' "$(kana 7)$(latin 33)"
check block '日本語 19 文字・英字 77 文字（2 割にわずかに届かない）' "$(kana 19)$(latin 77)"

# 7. 返答がない・空・文字列でないときは止めない
check none '空の返答' ''
expect_result none '返答の項目がない' "$(jq -n '{hook_event_name: "Stop", stop_hook_active: false}')"
expect_result none '返答が文字列でない' "$(jq -n '{hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: 123}')"
# 判断のスクリプトそのものも、返答がない・文字列でないときに失敗しない（.sh で失敗を隠していないこと）
for json in '{"hook_event_name":"Stop","stop_hook_active":false}' '{"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":123}'; do
  out=$(printf '%s' "$json" | node "$BIN/lib/reply-language-check.mjs")
  rc=$?
  if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "判断のスクリプトが、返答がない・文字列でないときに失敗した（rc=$rc、$json）"; fi
done

# 8. 入力が壊れているときは止めない（確かめる仕組みが壊れても、作業を止めない）
expect_result none '壊れた入力' '{not json'

# 9. node が動かないときは止めない
# 一時フォルダを作れたことを確かめてから、消す処理を登録する（作れないまま今のフォルダを消さないように）
tmp=$(mktemp -d "${TMPDIR:-/tmp}/reply-language-check-test.XXXXXX") || exit 1
[ -n "$tmp" ] && [ -d "$tmp" ] || exit 1
tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
for c in cat dirname; do ln -s "$(command -v "$c")" "$tmp/$c"; done
bash_path=$(command -v bash)
input=$(stop_input "$EN")
out=$(printf '%s' "$input" | PATH="$tmp" "$bash_path" "$HOOK")
rc=$?
if [ -z "$out" ] && [ "$rc" = 0 ]; then ok; else ng "node が動かないときに何かを出した・0 で終えない（rc=$rc、$out）"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
