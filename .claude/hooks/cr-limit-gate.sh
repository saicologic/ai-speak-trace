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
# 調べられないとき（jq・gh・node がない、gh の失敗、文面の変更など）は止めずに通す
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0
state_dir="$HOME/.claude/state"

# レビューを動かす部分を、引用符・$( )・heredoc・コメントを見分ける cr-limit-targets.mjs で探す
# （コミットメッセージや echo の文中の「git push」などは対象外。node がなければ調べられないので通す）
command -v node >/dev/null 2>&1 || exit 0
hook_dir=$(cd "$(dirname "$0")" && pwd)
targets=$(printf '%s' "$cmd" | node "$hook_dir/cr-limit-targets.mjs" "$cwd") || exit 0
[ -n "$targets" ] || exit 0
check_cli=""
check_github=""
top=""
while IFS= read -r t; do
  case "$(printf '%s' "$t" | jq -r .check)" in
    cli) check_cli=1 ;;
    github) check_github=1 ;;
  esac
  # 対象のリポジトリは、.coderabbit.yaml がある最初のフォルダのリポジトリ
  if [ -z "$top" ]; then
    d=$(printf '%s' "$t" | jq -r '.dir // empty')
    tt=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && [ -f "$tt/.coderabbit.yaml" ] && top=$tt
  fi
done <<<"$targets"
[ -n "$top" ] || exit 0

now=$(date +%s)
until=0
label=""
if [ -n "$check_cli" ]; then
  cli_until=$(cat "$state_dir/coderabbit-cli-limit-until" 2>/dev/null || echo 0)
  case "$cli_until" in ''|*[!0-9]*) cli_until=0 ;; esac
  if [ "$cli_until" -gt "$until" ]; then
    until=$cli_until
    label="手元の CodeRabbit CLI のレビュー枠"
  fi
fi
if [ -n "$check_github" ] && repo=$(cd "$top" && gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null); then
  # 枠切れの文面は Walkthrough のコメントに書かれ、レビューが終わると書き換わる。
  # 1日あたりの枠（per day）の文面も見落とさないよう、直近25時間に更新されたコメントを全ページ読む
  # 文面は2種類ある:
  #   - 枠切れで止まったとき: 「Next included review available in N minutes」→ コメントの時刻 + N 分
  #   - 最後の1回を使ったとき: 「up to 1 included review per hour; 0 remain」→ コメントの時刻 + 1時間（day なら1日）
  since=$(date -u -r $((now - 90000)) '+%Y-%m-%dT%H:%M:%SZ')
  gh_until=$(gh api --paginate "repos/$repo/issues/comments?since=$since&per_page=100" 2>/dev/null | jq -rs '
    [ add[]?
      | select(.user.login == "coderabbitai[bot]")
      | (.updated_at | fromdateiso8601) as $at
      | if (.body | test("available in [0-9]")) then
          (.body | capture("available in (?<d>[^.*\\n]+)") | .d) as $d
          | $at + ((($d | capture("(?<n>[0-9]+) hour") | .n | tonumber) // 0) * 3600
                   + (($d | capture("(?<n>[0-9]+) minute") | .n | tonumber) // 0) * 60
                   + (($d | capture("(?<n>[0-9]+) second") | .n | tonumber) // 0))
        elif (.body | test("included reviews? per (hour|day); 0 remain")) then
          $at + (if (.body | test("per day; 0 remain")) then 86400 else 3600 end)
        else empty end
    ] | max // 0 | floor' 2>/dev/null) || gh_until=0
  case "$gh_until" in ''|*[!0-9]*) gh_until=0 ;; esac
  if [ "$gh_until" -gt "$until" ]; then
    until=$gh_until
    label="GitHub の CodeRabbit のレビュー枠（${repo}）"
  fi
fi
[ "$until" -gt "$now" ] || exit 0

mins=$(( (until - now + 59) / 60 ))
at=$(date -r "$until" '+%H:%M')
msg="${label}が切れています。あと約${mins}分（${at} ごろ）で戻ります"
osascript -e "display notification \"$msg\" with title \"CodeRabbit の枠切れ\" sound name \"Basso\"" >/dev/null 2>&1 &

jq -n --arg msg "$msg" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: ($msg + "。この操作は CodeRabbit のレビューを動かしますが、今はレビューされません。戻る時刻まで待ってから実行するか、ユーザーに確認してください。急ぎで通す場合は、ユーザーの了承を得てコマンドに SKIP_CR_LIMIT=1 を付けてください。")}}'
exit 0
