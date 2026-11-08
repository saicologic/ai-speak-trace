#!/usr/bin/env bash
# PR のコミットを古い順に見て、TDD の順番を守っているか確かめる
#
# 1. 実装のファイルを変えたコミットより前（または同じコミット）に、テストのファイルを変えたコミットがあること
#    - その実装を参照しているテストがすでにあるときは、そのテストのどれかを変えていること
#      （参照しているテストは related-tests.mjs で探す。ほかのテストを変えただけでは通さない）
#    - refactor: と style: のコミットは、動きを変えないため対象外（今あるテストが通ることは CI のテストで確かめる）
#    - 実装ではないファイル（設定・ドキュメント・依存など）だけのコミットは対象外
# 2. test: 以外のコミットで、テストのファイルの expect( を減らしていないこと（テストのファイルを消すことも含む）
#
# ほかのブランチからマージしたコミット（main の取り込みなど）は、そのブランチの PR で確かめているため、
# --first-parent でこのブランチのコミットだけを調べる
#
# 使い方: check-tdd-order.sh <base> <head>
set -euo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd)

if [ $# -ne 2 ]; then
  echo "使い方: $0 <base> <head>" >&2
  exit 2
fi
base=$1
head=$2

is_test() {
  case "$1" in
    backend/src/*.spec.ts | frontend/src/*.test.ts | frontend/src/*.test.tsx) return 0 ;;
  esac
  return 1
}

is_impl() {
  is_test "$1" && return 1
  case "$1" in
    backend/src/*.ts | frontend/src/*.ts | frontend/src/*.tsx | backend/scripts/*) return 0 ;;
  esac
  return 1
}

# テストのファイルの差分から、expect( の数を数える（$1 は + か -、$3 はテストのファイル）
count_expect() {
  local sign=$1 commit=$2 file=$3
  git show --format= -U0 --no-renames "$commit" -- "$file" |
    awk -v s="$sign" 'substr($0, 1, 1) == s && substr($0, 1, 4) != s s s " " { n += gsub(/expect\(/, "") } END { print n + 0 }'
}

seen_test=false
# PR の中で変えたテストのファイル（1行に1つ）
changed_tests=""
failed=0
commits=$(git rev-list --reverse --first-parent --no-merges "$base..$head")

for c in $commits; do
  subject=$(git log -1 --format=%s "$c")
  short=$(git rev-parse --short "$c")
  impl_files=""
  while IFS= read -r -d '' f; do
    if is_test "$f"; then
      seen_test=true
      changed_tests="$changed_tests$f"$'\n'
    elif is_impl "$f"; then
      impl_files="$impl_files$f"$'\n'
    fi
  done < <(git diff-tree --no-commit-id --name-only -r -z --no-renames "$c")

  case "$subject" in
    refactor:* | refactor\(* | style:* | style\(*) structural=true ;;
    *) structural=false ;;
  esac

  if [ -n "$impl_files" ] && [ "$structural" = false ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      # この実装を参照しているテスト（このコミットの前にあったものと、このコミットで足したもの）
      related=$({
        node "$script_dir/related-tests.mjs" "$c^" "$f"
        node "$script_dir/related-tests.mjs" "$c" "$f"
      } | sort -u)
      if [ -n "$related" ]; then
        updated=false
        while IFS= read -r t; do
          if printf '%s' "$changed_tests" | grep -qxF -- "$t"; then
            updated=true
          fi
        done <<<"$related"
        if [ "$updated" = false ]; then
          echo "テストのある実装を、そのテストを変えずに変えています: $short $subject"
          echo "  実装: $f"
          while IFS= read -r t; do
            echo "  テスト: $t"
          done <<<"$related"
          failed=1
        fi
      elif [ "$seen_test" = false ]; then
        echo "テストより先に実装を変えています: $short $subject"
        echo "  実装: $f"
        failed=1
      fi
    done <<<"$impl_files"
  fi

  case "$subject" in
    test:* | test\(*) ;;
    *)
      # ファイルごとに比べる（ほかのテストに expect を足して、数を合わせられないように）
      while IFS= read -r -d '' t; do
        is_test "$t" || continue
        removed=$(count_expect - "$c" "$t")
        added=$(count_expect + "$c" "$t")
        if [ "$removed" -gt "$added" ]; then
          echo "テストのコミット（test:）以外で、テストの expect を減らしています（-$removed +$added）: $short $subject"
          echo "  テスト: $t"
          failed=1
        fi
      done < <(git diff-tree --no-commit-id --name-only -r -z --no-renames "$c")
      ;;
  esac
done

if [ "$failed" -ne 0 ]; then
  echo
  echo "テストを先にコミットし、実装を後からコミットしてください（CLAUDE.md の「テスト駆動開発（TDD）」）。"
  echo "テストを書けない変更だけの PR は、no-tdd のラベルを付けると、この確認を飛ばします。"
  exit 1
fi
count=0
for _ in $commits; do count=$((count + 1)); done
echo "TDD の順番を確かめました（${count} 件のコミット）"
