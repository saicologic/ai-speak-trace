#!/bin/bash
# Playwright MCP でページを開く（mcp__playwright__browser_navigate）開いた後。開く前に確かめて開けたサイトを、許可したサイトの一覧に足す
# （managed settings の PostToolUse の hook。インストール先 /opt/claude-code-team/bin で動く。中身は lib/playwright-navigate-gate.sh）
# テスト: bash .claude/team/tests/playwright-navigate-gate.test.sh
# shellcheck source=lib/playwright-navigate-gate.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/playwright-navigate-gate.sh"
navigate_gate post
