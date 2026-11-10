#!/bin/bash
# .coderabbit.yaml があるリポジトリで、手元の CodeRabbit レビュー（cr-review.sh）を通していない HEAD の git push を止める
# 急ぎのときは、push する部分の先頭に SKIP_CR_LOOP=1 を付けると通す
#
# push する部分は lib/git-push-segments.mjs で探す（引用符・heredoc・コメントの中の「git push」は対象外）。
# node がないときは、前の書き方（コマンドの文字列を grep する）で探す
# テスト: bash .claude/team/tests/cr-gate-push.test.sh
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0
hook_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/git-safety.sh
. "$hook_dir/lib/git-safety.sh"

# push する部分ごとに、push するフォルダ（1行に1つ）を集める
dirs=""
if command -v node >/dev/null 2>&1; then
  segments=$(printf '%s' "$cmd" | node "$hook_dir/lib/git-push-segments.mjs" SKIP_CR_LOOP) || exit 0
  [ -n "$segments" ] || exit 0
  while IFS= read -r seg; do
    # ブランチの削除・タグだけの push は対象外（ふつうのブランチも送る refspec が1つでもあれば対象）
    if printf '%s' "$seg" | jq -e '
        (.args | any(. == "--delete" or . == "-d")) or
        ([.args[] | select(startswith("-") | not)][1:] as $refs
          | if ($refs | length) > 0 then ($refs | all(startswith(":")))
            else (.args | index("--tags") != null) end)' >/dev/null; then
      continue
    fi
    d=$(printf '%s' "$seg" | jq -r '.dir // empty')
    dirs="$dirs${d:-$cwd}"$'\n'
  done <<<"$segments"
else
  printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)' || exit 0
  printf '%s' "$cmd" | grep -q 'SKIP_CR_LOOP=1' && exit 0
  # node がないときは、ブランチの削除（--delete）だけを対象外にする（タグ・:ref と一緒にブランチを送る push を見落とさないよう、止める側に倒す）
  printf '%s' "$cmd" | grep -Eq 'push[^;&|]*[[:space:]](--delete|-d)([[:space:]]|$)' && exit 0
  d=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+push.*/\1/p')
  [ -n "$d" ] || d=$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|[:space:]]+).*/\1/p')
  d="${d%\"}"
  d="${d#\"}"
  dirs="${d:-$cwd}"$'\n'
fi

while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  dir="${dir/#\~/$HOME}"
  # 相対パスは、hook の cwd から見る
  case "$dir" in
    /*) ;;
    *) [ -n "$cwd" ] && dir="$cwd/$dir" ;;
  esac
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || continue
  # 作業ツリーのファイルはサンドボックスの中から消せるため、push するコミット（HEAD）の中を見る
  git -C "$top" cat-file -e HEAD:.coderabbit.yaml 2>/dev/null || continue

  marker=$(review_marker "$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir)")
  head_sha=$(git -C "$dir" rev-parse HEAD)
  grep -qx "$head_sha" "$marker" 2>/dev/null && continue

  jq -n --arg sha "${head_sha:0:7}" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: ("HEAD (" + $sha + ") は手元の CodeRabbit レビューを通していません。cr-loop Skill の手順で /opt/claude-code-team/bin/cr-review.sh を実行し、指摘を直してから push してください。急ぎで飛ばす場合は、ユーザーの了承を得て github.sh に --skip SKIP_CR_LOOP を付けてください。")}}'
  exit 0
done <<<"$dirs"
exit 0
