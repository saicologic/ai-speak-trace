#!/bin/bash
# push の前に、CI の tdd-order と同じ確認（.github/scripts/check-tdd-order.sh）を手元で流し、
# 通らなければ止める（PreToolUse / Bash）。CI の結果を待たずに、push の前に気づけるようにする
#
# - 宛先は、今のブランチの PR の宛先（gh pr view）。PR がない・調べられないときは止めない（CI で確かめる）
# - PR に no-tdd のラベルがあるときは止めない（CI と同じ例外）
# - check-tdd-order.sh がないブランチ（この確認を入れる前のブランチ）では何もしない
# - 急ぎのときは、ユーザーの了承を得てコマンドに SKIP_TDD_CHECK=1 を付けると通す
# - 調べられないとき（jq・gh がない、gh の失敗など）は止めずに通す
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0

# コマンドを &&・||・;・|・改行で区切り、部分の先頭（環境変数の代入の後）で git push を実行するときだけ見る
# （コミットメッセージや echo の文中の「git push」は対象外）
lead='^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
is_push=false
while IFS= read -r seg; do
  # SKIP_TDD_CHECK=1 は、その部分の先頭に環境変数として付けたときだけ認める
  printf '%s' "$seg" | grep -Eq "${lead}SKIP_TDD_CHECK=1[[:space:]]" && continue
  if printf '%s' "$seg" | grep -Eq "${lead}git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*push([[:space:]]|\$)"; then
    is_push=true
  fi
done < <(printf '%s\n' "$cmd" | sed -E 's/(&&|\|\||;|\|)/\n/g')
[ "$is_push" = true ] || exit 0

if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || exit 0
fi
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
script="$root/.github/scripts/check-tdd-order.sh"
[ -f "$script" ] || exit 0

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
    echo "テストを書けない変更だけの PR は、no-tdd のラベルを付けてください。急ぎのときは、ユーザーの了承を得てコマンドに SKIP_TDD_CHECK=1 を付けてください。"
  } >&2
  exit 2
fi
exit 0
