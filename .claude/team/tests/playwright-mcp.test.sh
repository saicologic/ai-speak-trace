#!/bin/bash
# playwright-mcp.sh（Playwright MCP の起動。managed settings の allowedMcpServers で許す）のテスト
# （bash .claude/team/tests/playwright-mcp.test.sh）
# MCP サーバーはサンドボックスの外で動き、.mcp.json の env は managed settings の許可の確かめで比べられない。
# そのため、受け取った環境変数・引数・作業フォルダで、動かすものや動き方を変えられないことを確かめる
set -u
S="$(cd "$(dirname "$0")/../bin" && pwd)/playwright-mcp.sh"

pass=0
fail=0
# has <説明> <grep -E の式>: スクリプトに、その書き方があること
has() {
  if grep -Eq -- "$2" "$S"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  %s\n' "$1" "$2"
  fi
}
# lacks <説明> <grep -E の式>: スクリプトに、その書き方がないこと（コメントの行は除く）
lacks() {
  if grep -Ev '^[[:space:]]*#' "$S" | grep -Eq -- "$2"; then
    fail=$((fail + 1))
    printf 'FAIL: %s\n  %s\n' "$1" "$2"
  else
    pass=$((pass + 1))
  fi
}

if [ -f "$S" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $S がない"; fi

# 環境変数（NODE_OPTIONS・npm_config_*・PLAYWRIGHT_MCP_* など）を引き継がずに npx を動かす
has "環境変数を空にしてから npx を動かす（env -i）" 'exec /usr/bin/env -i .*npx'
# PATH・HOME は、受け取った環境変数ではなく、決めた値・アカウントの情報から作る
has "PATH を決めた値にする" '^PATH="?/'
has "HOME を、受け取った環境変数ではなく、アカウントの情報から求める" 'dscl \. -read "?/Users/'
lacks "PLAYWRIGHT_BROWSERS_PATH で、動かすブラウザを差し替えさせない" 'PLAYWRIGHT_BROWSERS_PATH'
# 作業フォルダの node_modules の npx・パッケージを使わない
has "npx を動かす前に、作業フォルダから出る" '^cd /( |$)'
# 引数を受け取って Playwright MCP に渡さない（--allow-unrestricted-file-access などを足させない）
lacks "受け取った引数を渡さない" '"\$@"|\$\*'
# バージョンを決めて取る
has "@playwright/mcp のバージョンを決める" '^PLAYWRIGHT_MCP_VERSION="[0-9]+\.[0-9]+\.[0-9]+"$'
lacks "latest を使わない" '@latest'
# プロフィールを残さない
has "プロフィールをディスクに残さない（--isolated）" '--isolated'

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
