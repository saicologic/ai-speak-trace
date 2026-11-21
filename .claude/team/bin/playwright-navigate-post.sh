#!/bin/bash
# Playwright MCP でページを開く（mcp__playwright__browser_navigate・URL を渡した mcp__playwright__browser_tabs）開いた後。開く前に確かめて開けたサイトを、許可したサイトの一覧に足す
# （managed settings の PostToolUse の hook。インストール先 /opt/claude-code-team/bin で動く。中身は lib/playwright-navigate-gate.sh）
# テスト: bash .claude/team/tests/playwright-navigate-gate.test.sh
# hook はサンドボックスの外で動くため、受け取った PATH は使わず、Playwright MCP（playwright-mcp.sh）と同じ決めた場所から node を探す
# （作業ツリーなどに置いた node を動かさない。brew の node@24 はふだんの bin にリンクされないため、Apple シリコン・Intel の Mac のその場所も入れる）
PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PATH
# 受け取った NODE_OPTIONS（--require など）・PERL5OPT・PERL5LIB・PERLLIB（-M など）は、node・perl に渡さない
unset NODE_OPTIONS PERL5OPT PERL5LIB PERLLIB
# shellcheck source=lib/playwright-navigate-gate.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/playwright-navigate-gate.sh"
navigate_gate post
