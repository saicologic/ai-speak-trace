#!/bin/bash
# PRのチェック（CI・CodeRabbitなど）がすべて終わるまで待ち、結果を出力する。
# 使い方: wait-pr-checks.sh <owner/repo> <PR番号>
# watch-pr-checks.sh（PostToolUseのhook）の指示で、Claudeがバックグラウンドで実行する。
# インストール先（/opt/claude-code-team/bin）から、managed settings の sandbox.excludedCommands でサンドボックスの外で動かす
# （gh が GitHub につなぐため）。外で動くため、引数は owner/repo と PR の番号の形だけを受け付ける
# テスト: bash .claude/team/tests/wait-pr-checks.test.sh
set -u

repo="${1-}"
number="${2-}"
if ! [[ "$repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || [[ "$repo" == */.* ]] || ! [[ "$number" =~ ^[0-9]+$ ]]; then
  echo "使い方: wait-pr-checks.sh <owner/repo> <PR番号>" >&2
  exit 1
fi
timeout_sec="${WAIT_PR_CHECKS_TIMEOUT:-3600}"
interval=60
settle="${WAIT_PR_CHECKS_SETTLE:-30}"

# 同じPRを二重に監視しない
lock="${TMPDIR:-/tmp}/wait-pr-checks-${repo//\//_}-${number}.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "ALREADY_WATCHING ${repo}#${number}"
  exit 0
fi
trap 'rmdir "$lock" 2>/dev/null' EXIT

# 全チェックが終わっているか（チェックが1つもない場合は終わっていない扱い）
all_done() {
  local json
  json=$(gh pr checks "$number" -R "$repo" --json name,bucket 2>/dev/null)
  [ -n "$json" ] && jq -e 'length > 0 and all(.bucket != "pending")' <<<"$json" >/dev/null
}

# push直後はチェックがまだ登録されていないことがあるので少し待つ
sleep "$settle"
start=$SECONDS
status="DONE"
while :; do
  if all_done; then
    # CodeRabbitのstatusが遅れて登録されることがあるため、少し待ってもう一度確かめる
    sleep "$settle"
    all_done && break
  fi
  if [ $((SECONDS - start)) -ge "$timeout_sec" ]; then
    status="TIMEOUT"
    break
  fi
  sleep "$interval"
done

pr=$(gh pr view "$number" -R "$repo" --json headRefOid,url,title,isDraft 2>/dev/null)
sha=$(jq -r '.headRefOid' <<<"$pr")
echo "STATUS: ${status}"
echo "PR: $(jq -r '"\(.url) \(.title)"' <<<"$pr")"
echo "DRAFT: $(jq -r '.isDraft' <<<"$pr")"
echo "CHECKS:"
gh pr checks "$number" -R "$repo" --json name,bucket --jq '.[] | "  \(.name): \(.bucket)"' 2>/dev/null

# CodeRabbitの状態（statusはレビューを省略した場合も指摘がある場合もsuccessになるため、説明文で区別する）
cr=$(gh api "repos/${repo}/commits/${sha}/status" \
  --jq '[.statuses[] | select(.context == "CodeRabbit")][0] | "\(.state)\t\(.description)"' 2>/dev/null)
cr_state="${cr%%$'\t'*}"
cr_desc="${cr#*$'\t'}"
case "$cr_state:$cr_desc" in
  ":"|"null:null") cr_review="none" ;;
  pending:*) cr_review="pending" ;;
  *:*[Ss]kipped*) cr_review="skipped" ;;
  success:*) cr_review="completed" ;;
  *) cr_review="$cr_state" ;;
esac
echo "CODERABBIT: ${cr_review} (${cr_desc})"

# 解決されていないCodeRabbitの指摘（重要度・見出し・場所）
# 行が残っているコメントはcommit_idが最新のコミットに付け替えられるため、コミットではなく
# レビュースレッドの解決状態で判断する（CodeRabbitは修正を確認するとスレッドを解決済みにする）
owner="${repo%%/*}"
name="${repo#*/}"
threads=$(gh api graphql -F owner="$owner" -F name="$name" -F number="$number" -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { isResolved path line originalLine comments(first: 1) { nodes { author { login } body } } }
        }
      }
    }
  }' 2>/dev/null)
comments=$(jq -r '.data.repository.pullRequest.reviewThreads.nodes[]
  | select(.comments.nodes[0].author.login == "coderabbitai")
  | (.comments.nodes[0].body | split("\n")) as $lines
  | (($lines[0] | capture("(?<s>(🔴|🟠|🟡|🔵|⚪)[^*]*)").s) // "-") as $sev
  | ([$lines[1:][] | select(test("^\\*\\*.+\\*\\*$"))][0] // $lines[0] | gsub("\\*\\*"; "")) as $title
  | "\(if .isResolved then "resolved" else "open" end)\t  - [\($sev | rtrimstr(" "))] \($title) (\(.path):\(.line // .originalLine))"' <<<"$threads" 2>/dev/null)
open=$(grep $'^open\t' <<<"$comments" | cut -f2-)
open_count=$(grep -c '^  - ' <<<"$open")
resolved_count=$(grep -c $'^resolved\t' <<<"$comments")
echo "CODERABBIT_OPEN_COMMENTS: ${open_count}"
echo "CODERABBIT_RESOLVED_COMMENTS: ${resolved_count}"
[ "$open_count" -gt 0 ] && echo "$open"
exit 0
