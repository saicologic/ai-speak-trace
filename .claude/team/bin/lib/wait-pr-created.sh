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

# 同じブランチを二重に見張らない。目印（ロック）は、見張るプロセスの番号を中身に持つシンボリックリンクで、
# ln -s の1回で作る（作ってから番号を書くまでの間に、別のプロセスが中身のない目印を残りものと取り違えないように）。
# 名前は repo とブランチのハッシュにして長さを決める（長いブランチ名で名前の長さの上限を超えないように。
# 改行はどちらの引数にも入らないため、区切りに使う）
key=$(printf '%s\n%s' "$repo" "$branch" | shasum -a 256 | cut -c1-32)
[[ "$key" =~ ^[0-9a-f]{32}$ ]] || { echo "目印の名前を作れません" >&2; exit 1; }
lock="${TMPDIR:-/tmp}/wait-pr-created-${key}.lock"
already() {
  echo "ALREADY_WATCHING ${repo} ${branch}"
  exit 0
}
# 前の形（フォルダ）の目印が残っていると、ln -s がその中にリンクを作ってしまうため、先に消す
if [ -d "$lock" ] && [ ! -L "$lock" ]; then rm -rf "$lock"; fi
if ! ln -sn "$$" "$lock" 2>/dev/null; then
  # 置き場所がないなど、目印がないのに作れないときは、見張っている人がいると取り違えずに止まる
  if [ ! -L "$lock" ]; then
    echo "目印を作れません: ${lock}" >&2
    exit 1
  fi
  pid=$(readlink "$lock" 2>/dev/null)
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then already; fi
  # 見張っていたプロセスがもういない。残った目印を消すのは、消す役の目印（<目印>.reclaim）を持つ1つのプロセスだけにする
  # （2つのプロセスが同じ残りものを見て、片方が取り直した目印を、もう片方が消さないように）。
  # 消す役の目印も残りもの（プロセスがいない）なら、それを消してから取る
  reclaim="${lock}.reclaim"
  # フォルダで置かれていると、rm -f で消せず ln -sn も失敗し続けるため、先に消す
  if [ -d "$reclaim" ] && [ ! -L "$reclaim" ]; then rm -rf "$reclaim"; fi
  if ! ln -sn "$$" "$reclaim" 2>/dev/null; then
    rpid=$(readlink "$reclaim" 2>/dev/null)
    if [[ "$rpid" =~ ^[0-9]+$ ]] && kill -0 "$rpid" 2>/dev/null; then already; fi
    [ "$(readlink "$reclaim" 2>/dev/null)" = "$rpid" ] && rm -f "$reclaim"
    ln -sn "$$" "$reclaim" 2>/dev/null || already
  fi
  # 消す役を持った後に、もう一度確かめる（待つ間に、別のプロセスが取り直しているかもしれないため）
  pid=$(readlink "$lock" 2>/dev/null)
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    rm -f "$reclaim"
    already
  fi
  rm -f "$lock"
  got=0
  ln -sn "$$" "$lock" 2>/dev/null && got=1
  rm -f "$reclaim"
  [ "$got" -eq 1 ] || already
fi
# 終わるときは、自分の番号の目印だけを消す
trap '[ "$(readlink "$lock" 2>/dev/null)" = "$$" ] && rm -f "$lock"; rm -f "${err_file-}"' EXIT

start=$SECONDS
# gh が失敗し続けたときに、PR がないのと区別できるよう、最後の失敗を覚えておく（成功したら消す）
gh_error=""
while :; do
  err_file=$(mktemp "${TMPDIR:-/tmp}/wait-pr-created-err.XXXXXX") || exit 1
  if json=$(gh pr list -R "$repo" --head "$branch" --state all --json number,url,title,state,isDraft,baseRefName 2>"$err_file"); then
    gh_error=""
    if jq -e 'type == "array" and length > 0' <<<"$json" >/dev/null 2>&1; then
      rm -f "$err_file"
      echo "STATUS: FOUND"
      jq -r '.[0] | "PR: \(.url) \(.title)", "NUMBER: \(.number)", "STATE: \(.state)", "DRAFT: \(.isDraft)", "BASE: \(.baseRefName)"' <<<"$json"
      exit 0
    fi
  else
    # 1行にまとめて、長すぎるときは切る
    gh_error=$(tr '\n' ' ' <"$err_file" | cut -c1-500)
    gh_error="${gh_error% }"
    [ -n "$gh_error" ] || gh_error="gh pr list が失敗しました"
  fi
  rm -f "$err_file"
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
