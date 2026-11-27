#!/bin/bash
# ブランチの PR ができるまで待ち、見つけた PR を出力する。
# 使い方: wait-pr-created.sh <owner/repo> <ブランチ>
# 子ワークツリーに渡した作業の PR を、元の session から見張るため、Claude が Bash の run_in_background で実行する。
# インストール先（/opt/claude-code-team/bin）から、managed settings の sandbox.excludedCommands でサンドボックスの外で動かす。
# 中身は lib/wait-pr-created.sh
# テスト: bash .claude/team/tests/wait-pr-created.test.sh
# サンドボックスの外で動くため、受け取った PATH は使わず、Playwright MCP（playwright-mcp.sh）と同じ決めた場所から gh・jq を探す
# （作業ツリーなどに置いた gh・jq を、サンドボックスの外で動かさない）
PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PATH
# shellcheck source=lib/wait-pr-created.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/wait-pr-created.sh"
