#!/bin/bash
# push の前に、CI の tdd-order と同じ確認（check-tdd-order.sh）を手元で流し、通らなければ止める
# （github.sh が push の前に、PreToolUse の hook と同じ入力で流す）。CI の結果を待たずに、push の前に気づけるようにする
#
# サンドボックスの外で動くため、install.sh が入れたもの（同じフォルダの ci/check-tdd-order.sh・ci/related-tests.mjs・
# lib/is-git-push.mjs）だけを動かす。作業ツリーの .github/scripts は、サンドボックスの中から書き換えられるため動かさない。
# CI のスクリプトを変えたときは、install.sh をもう一度実行すると、手元の確認も新しい版になる（CI はいつも新しい版で確かめる）
#
# - 宛先は、今のブランチの PR の宛先（gh pr view）。PR がない・調べられないときは止めない（CI で確かめる）
# - PR に no-tdd のラベルがあるときは止めない（CI と同じ例外）
# - リポジトリに .github/scripts/check-tdd-order.sh がないブランチ（この確認を入れる前のブランチ）では何もしない
# - 急ぎのときは、ユーザーの了承を得て SKIP_TDD_CHECK=1（github.sh では --skip SKIP_TDD_CHECK）を付けると通す
# - 調べられないとき（jq・gh・node がない、gh の失敗など）は止めずに通す
# - リポジトリの git の設定に、認めていない項目があれば、git を動かさずに止める（lib/git-safety.sh）
# - 確認のスクリプトが、順番の違反以外の理由で失敗したときも止める（CI の tdd-order も同じく失敗するため）
# テスト: backend/src/lint/tdd-push-gate.spec.ts
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0

# 部分の先頭で git push を実行するかは、引用符・$( )・heredoc・コメントを見分ける is-git-push.mjs で調べる
# （コミットメッセージや echo の文中の「git push」は対象外。node がなければ調べられないので通す）
command -v node >/dev/null 2>&1 || exit 0
here=$(cd "$(dirname "$0")" && pwd -P)
printf '%s' "$cmd" | node "$here/lib/is-git-push.mjs" || exit 0

if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || exit 0
fi
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/.github/scripts/check-tdd-order.sh" ] || exit 0
script="$here/ci/check-tdd-order.sh"
[ -f "$script" ] || exit 0

# shellcheck source=lib/git-safety.sh
. "$here/lib/git-safety.sh"
if ! (check_git_config); then
  echo "リポジトリの git の設定を確かめられないため、TDD の順番の確認を流さずに止めます。" >&2
  exit 2
fi

command -v gh >/dev/null 2>&1 || exit 0
pr=$(cd "$root" && gh pr view --json baseRefName,labels 2>/dev/null) || exit 0
base=$(printf '%s' "$pr" | jq -r '.baseRefName // empty')
[ -n "$base" ] || exit 0
if printf '%s' "$pr" | jq -e '.labels[]? | select(.name == "no-tdd")' >/dev/null; then
  exit 0
fi
git -C "$root" rev-parse -q --verify "origin/$base" >/dev/null || exit 0

if ! out=$(cd "$root" && bash "$script" "origin/$base" HEAD 2>&1); then
  {
    echo "TDD の順番の確認（CI の tdd-order と同じ。宛先は origin/$base）が通りません。push する前に直してください。"
    echo "$out"
    echo "テストを書けない変更だけの PR は、no-tdd のラベルを付けてください。急ぎのときは、ユーザーの了承を得て github.sh に --skip SKIP_TDD_CHECK を付けてください。"
  } >&2
  exit 2
fi
exit 0
