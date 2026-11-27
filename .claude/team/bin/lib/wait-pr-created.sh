#!/bin/bash
# ブランチの PR ができるまで待ち、見つけた PR を出力する。
# 使い方: wait-pr-created.sh <owner/repo> <ブランチ>
# 入口（bin/wait-pr-created.sh）が PATH を決めた値にしてから読む中身。テストでは、偽の gh を使うためこちらを直接動かす
# 子ワークツリーに渡した作業の PR を、元の session から見張るため、Claude が Bash の run_in_background で実行する。
# インストール先（/opt/claude-code-team/bin）から、managed settings の sandbox.excludedCommands でサンドボックスの外で動かす
# （gh が GitHub につなぐため）。外で動くため、引数は owner/repo とブランチ名の形だけを受け付け、gh pr list しか呼ばない
# テスト: bash .claude/team/tests/wait-pr-created.test.sh
set -u

usage() {
  echo "使い方: wait-pr-created.sh <owner/repo> <ブランチ>（ブランチは fix/・feature/・test/・release/・dependabot/ で始まるもの）" >&2
  exit 1
}

[ $# -eq 2 ] || usage
repo="$1"
branch="$2"
if ! [[ "$repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || [[ "$repo" == */.* ]]; then
  usage
fi
# ブランチは決めた頭で始まり、git のブランチ名として正しい形だけ（.. ・ // ・ .lock で終わるものは断る）
# git で作れない名前（/ ・ . で終わる、. で始まる部分、.lock で終わる部分）も断る
if ! [[ "$branch" =~ ^(fix|feature|test|release|dependabot)/[A-Za-z0-9._/-]+$ ]] ||
  [[ "$branch" == *..* ]] || [[ "$branch" == *//* ]] || [[ "$branch" == *.lock ]] ||
  [[ "$branch" == */ ]] || [[ "$branch" == *. ]] || [[ "$branch" == */.* ]] || [[ "$branch" == *.lock/* ]]; then
  usage
fi
# 待つ間隔は環境変数で変えない（外でユーザーの gh の認証を使って動くため、0 にして gh を休みなく呼ばせない）
interval=60
timeout_sec="${WAIT_PR_CREATED_TIMEOUT:-3600}"
# 7 桁までの数字だけ受け付け、先頭が 0 でも 10 進数として読む（08 を 8 進数として読んで、計算のエラーで止まらないように）
[[ "$timeout_sec" =~ ^[0-9]{1,7}$ ]] || timeout_sec=3600
timeout_sec=$((10#$timeout_sec))

# 同じブランチを二重に見張っても止めない（1分に1回 gh pr list を余分に呼ぶだけのため）。
# 目印（ロック）などのファイルは TMPDIR に作らない（TMPDIR はサンドボックスの中から書けるため、
# 名前をリンクに差し替えられると、サンドボックスの外のファイルに書いてしまう）

# gh は、決めた秒数のうちに終わらなければ止める（答えない gh を待ち続けない）。
# 止める役は /bin/sleep で待つ（テストで差し替える sleep を使わない）。出力は /dev/null にして、$( ) の終わりを待たせない
run_gh() {
  local limit=$1 pid watcher rc
  gh pr list -R "$repo" --head "$branch" --state all --limit 100 --json "$pr_fields" &
  pid=$!
  # 止める役が止められたときは、待っている sleep も止める（gh が先に終わるたびに、長い sleep を残さない）。
  # trap は sleep を動かす前に置き、sleep の番号が決まる前に止められたときは、決まった後に止める。
  # SIGTERM で止まらない gh（無視する設定を受け継いだものなど）は、5 秒待ってから SIGKILL で止める
  ( stop=0
    trap 'stop=1; [ -z "${s-}" ] || kill "$s" 2>/dev/null' TERM
    for step in "$limit" 5; do
      /bin/sleep "$step" &
      s=$!
      if [ "$stop" = 1 ]; then kill "$s" 2>/dev/null; exit 0; fi
      wait "$s"
      [ "$stop" = 1 ] && exit 0
      if [ "$step" = 5 ]; then kill -9 "$pid" 2>/dev/null; else kill "$pid" 2>/dev/null; fi
    done ) >/dev/null 2>&1 &
  watcher=$!
  wait "$pid"
  rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$rc"
}

# --limit 100: 既定の 30 件では、別のフォークの同じ名前のブランチの PR が多いと、見張るリポジトリの PR が入らないため
pr_fields="number,url,title,state,isDraft,baseRefName,headRepository,headRepositoryOwner,createdAt"
# 配列で、PR ごとに出す項目が決めた型であることを確かめ（isDraft の false も正しい値）、head のリポジトリが見張るリポジトリのものだけを残す。
# head のリポジトリがわからない PR（フォークが消されて headRepository が null など）は、エラーにせず除く
pr_filter='if type != "array" then error("配列ではありません") else . end
  | map(if type == "object" and (.number | type) == "number" and (.url | type) == "string" and (.title | type) == "string"
      and (.state | type) == "string" and (.isDraft | type) == "boolean" and (.baseRefName | type) == "string"
    then . else error("PR の項目が足りないか、型が違います") end)
  | map(select((.headRepository.name? | type) == "string" and (.headRepositoryOwner.login? | type) == "string"
      and ((.headRepositoryOwner.login + "/" + .headRepository.name | ascii_downcase) == $want)))'
want=$(printf '%s' "$repo" | tr 'A-Z' 'a-z')
# 見張り始めた時刻（UNIX 時刻）。これより前に作られて閉じていた PR は、前の作業の PR として除く
# （1回目の gh が失敗している間に作られてマージされた PR は見つけるよう、答えを読んだ時刻ではなく、最初に決める）。
# GitHub と手元の時計のずれを見込んで、60 秒前からを見張り始めた後とする
watch_start=$(( $(date +%s) - 60 ))
start=$SECONDS
# gh が失敗し続けたときに、PR がないのと区別できるよう、最後の失敗を覚えておく（成功したら消す）
gh_error=""
# gh の標準出力・標準エラー・終了コードは、TMPDIR の一時ファイルを通さず、パイプだけで受け取る
# （here-string（<<<）も bash 3.2 では一時ファイルを作るため使わない）。
# 標準エラー → NUL → 標準出力 → NUL → 終了コード → NUL の順に流れる（JSON とエラーの文には NUL が入らない）
while :; do
  # gh に使える秒数は残り時間で、1回あたり 120 秒まで（答えない gh で残り時間を使い切らず、次の回で確かめ直す）。
  # 最後の確かめでも gh が終われるよう、10 秒は使える。時間切れ 0（1回だけ確かめる）のときは 30 秒
  limit=$((timeout_sec - (SECONDS - start)))
  [ "$limit" -le 120 ] || limit=120
  [ "$limit" -ge 10 ] || limit=10
  [ "$timeout_sec" -ne 0 ] || limit=30
  err="" json="" rc=""
  { IFS= read -r -d '' err; IFS= read -r -d '' json; IFS= read -r -d '' rc; } < <(
    (printf '\0%s\0%s\0' "$(run_gh "$limit")" "$?" 1>&2) 2>&1
  )
  if [ "$rc" = 0 ]; then
    # 答えの形（配列で、PR ごとに決めた型の項目がある）を確かめ、見張るリポジトリの PR だけにする
    # （別のフォークの同じ名前のブランチから開いた PR を除く。owner/repo の大文字・小文字は区別しない）。
    # jq が失敗したら、PR がないのと区別してエラーにする
    # 何も答えない（標準出力が空）ときも、-e で失敗にする（[] は正しい答え）
    if prs=$(printf '%s' "$json" | jq -ce --arg want "$want" "$pr_filter" 2>&1); then
      gh_error=""
      # 開いている PR と、見張り始めた後に作られた PR（すぐマージされたものも）を見つける。
      # 作った時刻が読めない閉じた PR は、前の作業の PR として除く
      if info=$(printf '%s' "$prs" | jq -er --argjson start "$watch_start" \
        '[.[] | select(.state == "OPEN" or ((.createdAt | type) == "string" and ((.createdAt | fromdateiso8601?) // 0) >= $start))] | .[0] // empty
        | "PR: \(.url) \(.title)", "NUMBER: \(.number)", "STATE: \(.state)", "DRAFT: \(.isDraft)", "BASE: \(.baseRefName)"' 2>/dev/null); then
        echo "STATUS: FOUND"
        printf '%s\n' "$info"
        exit 0
      fi
    else
      gh_error="gh pr list の答えを読めません: ${prs}"
    fi
  elif [ "$rc" = 143 ] || [ "$rc" = 137 ]; then
    gh_error="gh pr list が時間内に終わりませんでした（${limit} 秒）"
  else
    gh_error="${err}"
    [ -n "$gh_error" ] || gh_error="gh pr list が失敗しました（終了コード ${rc}）"
  fi
  # 1行にまとめて、長すぎるときは切る
  gh_error=$(printf '%s' "$gh_error" | tr '\n' ' ' | cut -c1-500)
  gh_error="${gh_error% }"
  if [ $((SECONDS - start)) -ge "$timeout_sec" ]; then
    echo "STATUS: TIMEOUT"
    echo "BRANCH: ${repo} ${branch}"
    [ -z "$gh_error" ] || echo "GH_ERROR: ${gh_error}"
    exit 0
  fi
  # 残り時間より長く待たない
  wait_sec=$((timeout_sec - (SECONDS - start)))
  [ "$wait_sec" -le "$interval" ] || wait_sec=$interval
  sleep "$wait_sec"
done
