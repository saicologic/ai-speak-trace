#!/bin/bash
# CodeRabbit のレビュー枠が切れている間、レビューを動かす操作を止めて通知する（PreToolUse / Bash）
#
# - GitHub 側: gh pr comment ...@coderabbitai / gh pr create / gh pr ready / git push
#   リポジトリの直近の coderabbitai[bot] のコメントにある「Next included review available in N minutes」から
#   枠が戻る時刻を求める
# - 手元の CLI: ~/.claude/hooks/cr-review.sh（メンテナー個人の、push 前に CodeRabbit CLI でレビューするスクリプト）
#   cr-review.sh が枠切れで失敗したときに記録する時刻（~/.claude/state/coderabbit-cli-limit-until）を使う
#   cr-review.sh がない環境では、この部分は何もしない
#
# GitHub は読むだけで、書き込みはしない。コメントからは時間の数字だけを取り出し、通知の文面には入れない
# 急ぎのときは、ユーザーの了承を得てコマンドに SKIP_CR_LIMIT=1 を付けると通す
# 調べられないとき（jq・gh がない、gh の失敗、文面の変更など）は止めずに通す
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -q 'SKIP_CR_LIMIT=1' && exit 0

state_dir="$HOME/.claude/state"

kind=""
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])(~|\$HOME|/[^[:space:]]*)/\.claude/hooks/cr-review\.sh([[:space:]]|$)'; then
  # --accept・--base はレビューを動かさない
  printf '%s' "$cmd" | grep -Eq 'cr-review\.sh[^;&|]*(--accept|[[:space:]]--base([[:space:]]|$))' || kind="cli"
elif printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+comment([[:space:]]|$)' &&
  printf '%s' "$cmd" | grep -q '@coderabbitai'; then
  kind="github"
elif printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  kind="github"
elif printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$)' &&
  ! printf '%s' "$cmd" | grep -q -- '--undo'; then
  kind="github"
elif printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)' &&
  ! printf '%s' "$cmd" | grep -Eq 'push[^;&|]*(--delete|--tags|[[:space:]]:[^[:space:]])'; then
  kind="github"
fi
[ -n "$kind" ] || exit 0

# 対象のリポジトリ: git -C <dir> → 先頭の cd <dir> → フックの cwd
dir=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+push.*/\1/p')
[ -n "$dir" ] || dir=$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|[:space:]]+).*/\1/p')
[ -n "$dir" ] || dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
dir="${dir/#\~/$HOME}"
dir="${dir%\"}"; dir="${dir#\"}"
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$top/.coderabbit.yaml" ] || exit 0

now=$(date +%s)
until=0
label=""
if [ "$kind" = "cli" ]; then
  until=$(cat "$state_dir/coderabbit-cli-limit-until" 2>/dev/null || echo 0)
  label="手元の CodeRabbit CLI のレビュー枠"
else
  repo=$(cd "$top" && gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) || exit 0
  # 枠切れの文面は Walkthrough のコメントに書かれ、レビューが終わると書き換わるため、更新日時の新しい順に見る
  until=$(gh api "repos/$repo/issues/comments?sort=updated&direction=desc&per_page=30" 2>/dev/null | jq -r '
    [ .[]
      | select(.user.login == "coderabbitai[bot]")
      | select(.body | test("available in [0-9]"))
      | (.body | capture("available in (?<d>[^.*\\n]+)") | .d) as $d
      | ((($d | capture("(?<n>[0-9]+) hour") | .n | tonumber) // 0) * 3600
         + (($d | capture("(?<n>[0-9]+) minute") | .n | tonumber) // 0) * 60
         + (($d | capture("(?<n>[0-9]+) second") | .n | tonumber) // 0)) as $secs
      | (.updated_at | fromdateiso8601) + $secs
    ] | max // 0' 2>/dev/null) || exit 0
  label="GitHub の CodeRabbit のレビュー枠（${repo}）"
fi
case "$until" in ''|*[!0-9]*) exit 0 ;; esac
[ "$until" -gt "$now" ] || exit 0

mins=$(( (until - now + 59) / 60 ))
at=$(date -r "$until" '+%H:%M')
msg="${label}が切れています。あと約${mins}分（${at} ごろ）で戻ります"
osascript -e "display notification \"$msg\" with title \"CodeRabbit の枠切れ\" sound name \"Basso\"" >/dev/null 2>&1 &

jq -n --arg msg "$msg" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: ($msg + "。この操作は CodeRabbit のレビューを動かしますが、今はレビューされません。戻る時刻まで待ってから実行するか、ユーザーに確認してください。急ぎで通す場合は、ユーザーの了承を得てコマンドに SKIP_CR_LIMIT=1 を付けてください。")}}'
exit 0
