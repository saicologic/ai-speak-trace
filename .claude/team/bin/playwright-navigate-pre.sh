#!/bin/bash
# Playwright MCP でページを開く（mcp__playwright__browser_navigate）開く前。許可したサイトは allow、初めてのサイトは ask、サイトではない URL は deny を返す
# （managed settings の PreToolUse の hook。インストール先 /opt/claude-code-team/bin で動く。中身は lib/playwright-navigate-gate.sh）
# テスト: bash .claude/team/tests/playwright-navigate-gate.test.sh
# shellcheck source=lib/playwright-navigate-gate.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/playwright-navigate-gate.sh"
navigate_gate pre
