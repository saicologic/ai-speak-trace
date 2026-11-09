#!/bin/bash
# push 前に CodeRabbit CLI で手元のコミットをレビューする（cr-loop Skill から使う）
#
# 使い方:
#   cr-review.sh            親ブランチとの差分をレビューする。minor 以上の指摘がなければ HEAD を「レビュー済み」にする
#   cr-review.sh --accept   今の HEAD を「レビュー済み」にする（上限回数に達した・残りは直さないと判断した場合）
#   cr-review.sh --base     レビューで比べる親ブランチを表示する
#   CR_BASE=<branch> cr-review.sh   親ブランチを指定する（PR を作る前の子ブランチで使う）
#   cr-review.sh --base-branch <branch>   CR_BASE と同じ。Claude Code のサンドボックスの excludedCommands は
#                                         先頭に環境変数の代入があるコマンドに一致しないため、引数でも渡せるようにする
#
# 終了コード: 0 = 指摘なし（レビュー済みにした） / 2 = minor 以上の指摘あり / それ以外 = エラー
# レビュー済みの HEAD は <git-common-dir>/coderabbit-reviewed に記録し、cr-gate-push.sh が push 時に確かめる
#
# インストール先（/opt/claude-code-team/bin）から、managed settings の sandbox.excludedCommands でサンドボックスの外で動かす
# （CodeRabbit CLI がキーチェーンのログイン情報を使うため）。外で動くため:
# - 動かす CodeRabbit CLI は ~/.local/bin/coderabbit に決める（環境変数で差し替えない）
# - リポジトリの git の設定は、決めた項目だけを認める（lib/git-safety.sh）
# テスト: bash .claude/team/tests/cr-review.test.sh
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
# shellcheck source=lib/git-safety.sh
. "$here/lib/git-safety.sh"

CR="$HOME/.local/bin/coderabbit"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "git リポジトリではありません" >&2; exit 1; }
check_git_config
marker="$(git rev-parse --path-format=absolute --git-common-dir)/coderabbit-reviewed"
head_sha=$(git rev-parse HEAD)

# 親ブランチの名前が、ブランチ名の形か（- で始まるもの・.. などを断る。git fetch のオプションにさせない）
check_branch_name() {
  if [[ "$1" == -* ]] || ! git check-ref-format --branch "$1" >/dev/null 2>&1; then
    echo "親ブランチの名前が正しくありません: $1" >&2
    exit 1
  fi
}

# 親ブランチ: CR_BASE → PR の宛先 → なければ main
resolve_base() {
  local base="${CR_BASE:-}"
  [ -n "$base" ] && { echo "$base"; return; }
  base=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null) || base=""
  [ -n "$base" ] || base="main"
  echo "$base"
}

mark_reviewed() {
  echo "$head_sha" >>"$marker"
  echo "REVIEWED: $head_sha"
}

if [ "${1:-}" = "--base-branch" ]; then
  [ -n "${2:-}" ] || { echo "--base-branch には親ブランチを指定してください" >&2; exit 1; }
  CR_BASE="$2"
  shift 2
fi

case "${1:-}" in
  --accept) mark_reviewed; exit 0 ;;
  --base) resolve_base; exit 0 ;;
esac

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "コミットしていない変更があります。push する内容と同じになるよう、コミットしてからレビューしてください" >&2
  exit 1
fi

base=$(resolve_base)
check_branch_name "$base"
# 親ブランチは GitHub の origin から取る（origin を手元のパスなどに向けて、外で git を動かさせない）
origin_urls=$(git config --get-all remote.origin.url) || origin_urls=""
[ -n "$origin_urls" ] || { echo "origin の URL がありません" >&2; exit 1; }
while IFS= read -r u; do
  github_slug "$u" >/dev/null || { echo "origin が GitHub の URL ではありません: $u" >&2; exit 1; }
done <<<"$origin_urls"
git fetch -q origin -- "$base" 2>/dev/null || true
# リモートの親ブランチがあればそちらと比べる（ローカルの親が古いと差分が増えるため）
if git rev-parse -q --verify "origin/$base" >/dev/null; then
  base_commit=$(git merge-base HEAD "origin/$base")
else
  base_commit=$(git merge-base HEAD "$base" 2>/dev/null)
fi
# 比べるコミットが決まらないまま CodeRabbit CLI を呼ばない
[ -n "$base_commit" ] || { echo "親ブランチ（$base）が手元にも origin にもないため、比べるコミットを決められません" >&2; exit 1; }
echo "BASE: $base ($base_commit)"

out=$(mktemp)
"$CR" review --deep --agent --committed --base-commit "$base_commit" --gate minor | tee "$out"
status=${PIPESTATUS[0]}
# 枠切れのときは、戻る時刻を cr-limit-gate.sh が読む場所に記録する
# 出力には JSON でない行（Tip: など）も混ざるため、JSON の行だけを読む
wait_time=$(grep '^{' "$out" | jq -r 'select(.type == "error" and .errorType == "rate_limit") | .metadata.waitTime // empty' 2>/dev/null | head -1)
rm -f "$out"
if [ -n "$wait_time" ]; then
  h=$(printf '%s' "$wait_time" | sed -nE 's/^(.*[^0-9])?([0-9]+) hour.*/\2/p'); h=${h:-0}
  m=$(printf '%s' "$wait_time" | sed -nE 's/^(.*[^0-9])?([0-9]+) minute.*/\2/p'); m=${m:-0}
  s=$(printf '%s' "$wait_time" | sed -nE 's/^(.*[^0-9])?([0-9]+) second.*/\2/p'); s=${s:-0}
  mkdir -p "$HOME/.claude/state"
  echo $(( $(date +%s) + h * 3600 + m * 60 + s )) >"$HOME/.claude/state/coderabbit-cli-limit-until"
  echo "RATE_LIMIT: 手元のレビュー枠が切れています（あと ${wait_time}）" >&2
fi
case $status in
  0) mark_reviewed; exit 0 ;;
  2) echo "FINDINGS: minor 以上の指摘があります"; exit 2 ;;
  *) echo "ERROR: coderabbit review が終了コード $status で失敗しました" >&2; exit "$status" ;;
esac
