#!/bin/bash
# ブランチの PR ができるまで待ち、見つけた PR を出力する。
# 使い方: wait-pr-created.sh <owner/repo> <ブランチ>
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
if ! [[ "$branch" =~ ^(fix|feature|test|release|dependabot)/[A-Za-z0-9._/-]+$ ]] ||
  [[ "$branch" == *..* ]] || [[ "$branch" == *//* ]] || [[ "$branch" == *.lock ]]; then
  usage
fi
# 待つ間隔は環境変数で変えない（外でユーザーの gh の認証を使って動くため、0 にして gh を休みなく呼ばせない）
interval=60
timeout_sec="${WAIT_PR_CREATED_TIMEOUT:-3600}"
[[ "$timeout_sec" =~ ^[0-9]+$ ]] || timeout_sec=3600

# 同じブランチを二重に見張らない。目印（ロック）に見張るプロセスの番号を書き、強制終了で目印が残っても、
# そのプロセスがもういなければ消して見張る。名前の / は、どちらの引数にも使えない + に変える
# （_ に変えると、fix/a/b と fix/a_b が同じ目印になるため）
lock="${TMPDIR:-/tmp}/wait-pr-created-${repo//\//+}-${branch//\//+}.lock"
if ! mkdir "$lock" 2>/dev/null; then
  pid=$(cat "$lock/pid" 2>/dev/null)
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    echo "ALREADY_WATCHING ${repo} ${branch}"
    exit 0
  fi
  rm -rf "$lock"
  if ! mkdir "$lock" 2>/dev/null; then
    echo "ALREADY_WATCHING ${repo} ${branch}"
    exit 0
  fi
fi
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"; rm -f "${err_file-}"' EXIT

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
  sleep "$interval"
done
