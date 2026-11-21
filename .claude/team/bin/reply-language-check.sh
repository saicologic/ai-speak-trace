#!/bin/bash
# 返答の最後のメッセージが英語のときは、止めて日本語で書き直させる hook
# （managed settings の Stop の hook。インストール先 /opt/claude-code-team/bin で動く）
# 返答は日本語で書く決まりだが、長い作業の後などに英語になることがあるため、仕組みで止める
#
# - 判断は lib/reply-language-check.mjs（コード・URL・パスを除いて、日本語の文字と英字の数を比べる）
# - 書き直しの途中（stop_hook_active）は、もう一度は止めない（終わらなくならないように）
# - node が動かない・入力が壊れているときは、何もしない（確かめる仕組みが壊れても、作業は止めない）
# テスト: bash .claude/team/tests/reply-language-check.test.sh
hook_dir="$(cd "$(dirname "$0")" && pwd)"
input=$(cat)
command -v node >/dev/null 2>&1 || exit 0
out=$(printf '%s' "$input" | node "$hook_dir/lib/reply-language-check.mjs" 2>/dev/null) || exit 0
[ -n "$out" ] && printf '%s\n' "$out"
exit 0
