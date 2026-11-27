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
  gh pr list -R "$repo" --head "$branch" --state all --json number,url,title,state,isDraft,baseRefName &
  pid=$!
  ( /bin/sleep "$limit"; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  watcher=$!
  wait "$pid"
  rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$rc"
}

start=$SECONDS
# gh が失敗し続けたときに、PR がないのと区別できるよう、最後の失敗を覚えておく（成功したら消す）
gh_error=""
# gh の標準出力・標準エラー・終了コードは、TMPDIR の一時ファイルを通さず、パイプだけで受け取る
# （here-string（<<<）も bash 3.2 では一時ファイルを作るため使わない）。
# 標準エラー → NUL → 標準出力 → NUL → 終了コード → NUL の順に流れる（JSON とエラーの文には NUL が入らない）
while :; do
  # gh に使える秒数は残り時間。ただし、最後の確かめでも gh が終われるよう、10 秒は使える。
  # 時間切れ 0（1回だけ確かめる）のときは 30 秒
  limit=$((timeout_sec - (SECONDS - start)))
  [ "$limit" -ge 10 ] || limit=10
  [ "$timeout_sec" -ne 0 ] || limit=30
  err="" json="" rc=""
  { IFS= read -r -d '' err; IFS= read -r -d '' json; IFS= read -r -d '' rc; } < <(
    (printf '\0%s\0%s\0' "$(run_gh "$limit")" "$?" 1>&2) 2>&1
  )
  if [ "$rc" = 0 ]; then
    # PR の数を数え、見つかったら出す内容を先に作る。どちらかで jq が失敗したら、PR がないのと区別してエラーにする
    if count=$(printf '%s' "$json" | jq -e 'if type == "array" then length else error("配列ではありません") end' 2>&1); then
      gh_error=""
      if [ "$count" -gt 0 ] && info=$(printf '%s' "$json" | jq -er '.[0] | "PR: \(.url) \(.title)", "NUMBER: \(.number)", "STATE: \(.state)", "DRAFT: \(.isDraft)", "BASE: \(.baseRefName)"' 2>&1); then
        echo "STATUS: FOUND"
        printf '%s\n' "$info"
        exit 0
      elif [ "$count" -gt 0 ]; then
        gh_error="gh pr list の答えを読めません: ${info}"
      fi
    else
      [ "$count" = 0 ] && count=""
      gh_error="gh pr list の答えを読めません: ${count}"
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
