#!/bin/bash
# cr-gate-push.sh のテスト（bash .claude/team/tests/cr-gate-push.test.sh）
# 一時リポジトリ（.coderabbit.yaml あり）を作り、hook に PreToolUse の入力を渡して、止める（deny）か通すかを確かめる
set -u
HOOK="$(cd "$(dirname "$0")/../bin" && pwd)/cr-gate-push.sh"
PUSH="git push"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

# macOS の mktemp -d は TMPDIR を見ないため、場所を指定する（サンドボックスで書ける場所）
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cr-gate-push-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
other="$tmp/other"
mkdir -p "$repo" "$other" "$repo/sub dir"
for d in "$repo" "$other"; do
  git -C "$d" init -q
  touch "$d/.coderabbit.yaml" "$d/a"
  git -C "$d" add -A
  git -C "$d" commit -q -m init
done
# レビュー済みの記録は、サンドボックスの中から書けない ~/.claude/state の下に、リポジトリ（git-common-dir）ごとに置く
export HOME="$tmp/home"
marker() {
  local common
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)
  mkdir -p "$HOME/.claude/state/coderabbit-reviewed"
  echo "$HOME/.claude/state/coderabbit-reviewed/$(printf '%s' "$common" | git hash-object --stdin)"
}
old_marker() { echo "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/coderabbit-reviewed"; }
reviewed() { git -C "$1" rev-parse HEAD >>"$(marker "$1")"; }
unreviewed() { : >"$(marker "$1")"; }

pass=0
fail=0
# check <期待（deny / allow）> <説明> <コマンド> [cwd]
check() {
  local want=$1 name=$2 cmd=$3 cwd=${4:-$repo}
  local out got
  out=$(jq -n --arg c "$cmd" --arg d "$cwd" '{tool_input: {command: $c}, cwd: $d}' | bash "$HOOK")
  if printf '%s' "$out" | grep -q '"deny"'; then got=deny; else got=allow; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s（期待 %s、結果 %s）\n  %s\n' "$name" "$want" "$got" "$cmd"
  fi
}

unreviewed "$repo"
unreviewed "$other"

# push と見なして止める
check deny "そのままの push" "$PUSH"
check deny "環境変数の後" "FOO=1 $PUSH"
check deny "空白を含む値の後" "FOO=\"a b\" $PUSH"
check deny "-c の後" "git -c core.x=1 push"
check deny "&& の後" "npm test && $PUSH -u origin x"
check deny "改行の後" "npm test
$PUSH"
check deny "括弧の中" "(cd \"$repo\" && $PUSH)"
check deny "then の後" "if true; then $PUSH; fi"
check deny "here-string の後" "cat <<< \"x\"
$PUSH"

# push ではないので通す（文中の git push）
check allow "コミットメッセージの中（; の後）" "git commit -m \"直す; $PUSH は後で\""
check allow "echo の中" "echo \"a && $PUSH\""
check allow "heredoc のコミットメッセージの本文" "git commit -m \"\$(cat <<'EOF'
直す

$PUSH の前に確かめる
EOF
)\""
check allow "heredoc の本文" "cat <<EOF > /dev/null
$PUSH
EOF"
check allow "grep の引数" "grep -n \"$PUSH\" README.md"
check allow "コメント" "ls # $PUSH"

# 急ぎのとき・push しないもの
check allow "SKIP_CR_LOOP=1 を先頭に付けた" "SKIP_CR_LOOP=1 $PUSH"
check deny "SKIP_CR_LOOP=1 を別の部分に付けた" "SKIP_CR_LOOP=1 echo x && $PUSH"
check deny "SKIP_CR_LOOP=1 をコメントに書いた" "$PUSH # SKIP_CR_LOOP=1"
check allow "ブランチの削除（--delete）" "$PUSH origin --delete old"
check allow "ブランチの削除（:ref）" "$PUSH origin :old"
check allow "タグだけ" "$PUSH --tags"
check allow "タグだけ（リモートあり）" "$PUSH origin --tags"
check allow "削除だけ（:ref を2つ）" "$PUSH origin :old :older"
# ブランチも送る push は、タグ・削除と一緒でも確かめる
check deny "タグとブランチを一緒に送る" "$PUSH origin main --tags"
check deny "削除とブランチを一緒に送る" "$PUSH origin :old feature"

# どのリポジトリの push か
reviewed "$repo"
check allow "レビュー済みの HEAD" "$PUSH"
# サンドボックスの中から書ける .git の中に HEAD を書いても、レビュー済みにならない
unreviewed "$repo"
git -C "$repo" rev-parse HEAD >>"$(old_marker "$repo")"
check deny ".git/coderabbit-reviewed に HEAD を書いた" "$PUSH"
rm -f "$(old_marker "$repo")"
reviewed "$repo"
# 作業ツリーの .coderabbit.yaml を消しても（コミットには残っている）、確かめる
unreviewed "$repo"
rm "$repo/.coderabbit.yaml"
check deny "作業ツリーの .coderabbit.yaml を消した" "$PUSH"
git -C "$repo" checkout -q -- .coderabbit.yaml
reviewed "$repo"
check deny "git -C で別のリポジトリ（未レビュー）" "git -C \"$other\" push"
check deny "先頭の cd で別のリポジトリ（未レビュー）" "cd \"$other\" && $PUSH"
check allow "cwd が別でも、git -C でレビュー済みのリポジトリ" "git -C \"$repo\" push" "$other"
check allow "空白のあるフォルダ（同じリポジトリ）への cd" "cd \"$repo/sub dir\" && $PUSH"
check allow ".coderabbit.yaml のないリポジトリ" "$PUSH" "$tmp"

# 止めたときは、インストール先の cr-review.sh を案内する
unreviewed "$repo"
reason=$(jq -n --arg c "$PUSH" --arg d "$repo" '{tool_input: {command: $c}, cwd: $d}' | bash "$HOOK" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
if printf '%s' "$reason" | grep -qF '/opt/claude-code-team/bin/cr-review.sh'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: 止めたときの案内に /opt/claude-code-team/bin/cr-review.sh がない\n  %s\n' "$reason"
fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
