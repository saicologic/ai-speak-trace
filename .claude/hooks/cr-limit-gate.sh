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
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0
state_dir="$HOME/.claude/state"

# コマンドを &&・||・;・|・改行で区切り、部分ごとに判定する（ある部分の除外が、ほかの部分に効かないように）
# gh・git は、その部分の先頭（環境変数の代入の後）で実行するときだけ見る（コミットメッセージなどの文中は対象外）
lead='^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
check_cli=""
check_github=""
while IFS= read -r seg; do
  # SKIP_CR_LIMIT=1 は、その部分の先頭に環境変数として付けたときだけ認める
  printf '%s' "$seg" | grep -Eq '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*SKIP_CR_LIMIT=1[[:space:]]' && continue
  # cr-review.sh は、その部分の先頭で実行するときだけ見る（grep などの引数にパスがあるだけなら対象外）
  if printf '%s' "$seg" | grep -Eq '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(bash[[:space:]]+)?(~|\$HOME|/[^[:space:]]*)/\.claude/hooks/cr-review\.sh([[:space:]]|$)'; then
    # --accept・--base はレビューを動かさない
    printf '%s' "$seg" | grep -Eq '[[:space:]](--accept|--base)([[:space:]]|$)' || check_cli=1
  elif printf '%s' "$seg" | grep -Eq "$lead"'gh[[:space:]]+pr[[:space:]]+comment([[:space:]]|$)'; then
    # 本文の中の ; などで区切られても見落とさないよう、@coderabbitai はコマンド全体から探す
    printf '%s' "$cmd" | grep -q '@coderabbitai' && check_github=1
    # 本文をファイルから読む場合（-F・--body-file）は、そのファイルからも探す
    body_file=$(printf '%s' "$seg" | sed -nE "s/.*(-F|--body-file)(=|[[:space:]]+)(\"[^\"]*\"|'[^']*'|[^[:space:]]+).*/\3/p")
    body_file="${body_file%[\"\']}"; body_file="${body_file#[\"\']}"
    body_file="${body_file/#\~/$HOME}"
    [ -n "$body_file" ] && [ "${body_file#/}" = "$body_file" ] && body_file="$cwd/$body_file"
    [ -f "$body_file" ] && grep -q '@coderabbitai' "$body_file" 2>/dev/null && check_github=1
  elif printf '%s' "$seg" | grep -Eq "$lead"'gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
    check_github=1
  elif printf '%s' "$seg" | grep -Eq "$lead"'gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$)'; then
    printf '%s' "$seg" | grep -q -- '--undo' || check_github=1
  elif printf '%s' "$seg" | grep -Eq "$lead"'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)'; then
    # ブランチの削除・タグだけの push はレビューを動かさない（ふつうのブランチも送る push は対象）
    push_args=$(printf '%s' "$seg" | sed -E 's/.*(^|[[:space:]])push([[:space:]]|$)//')
    read -ra push_toks <<<"$push_args"
    has_delete=""; has_tags=""; remote=""; refspecs=()
    for tok in "${push_toks[@]}"; do
      case "$tok" in
        --delete|-d) has_delete=1 ;;
        --tags) has_tags=1 ;;
        -*) ;;
        *) if [ -z "$remote" ]; then remote=$tok; else refspecs+=("$tok"); fi ;;
      esac
    done
    if [ -n "$has_delete" ]; then
      :
    elif [ "${#refspecs[@]}" -gt 0 ]; then
      # 削除（:branch）以外の refspec が1つでもあれば対象
      for r in "${refspecs[@]}"; do
        case "$r" in :*) ;; *) check_github=1 ;; esac
      done
    elif [ -z "$has_tags" ]; then
      check_github=1
    fi
  fi
done < <(printf '%s\n' "$cmd" | awk '{ gsub(/&&|\|\||;|\|/, "\n"); print }')
[ -n "$check_cli$check_github" ] || exit 0

# 対象のリポジトリ: git -C <dir> → 先頭の cd <dir> → フックの cwd
dir=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+push.*/\1/p')
[ -n "$dir" ] || dir=$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|[:space:]]+).*/\1/p')
[ -n "$dir" ] || dir=$cwd
dir="${dir/#\~/$HOME}"
dir="${dir%\"}"; dir="${dir#\"}"
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$top/.coderabbit.yaml" ] || exit 0

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
