#!/bin/sh
# Playwright MCP を「Google Chrome for Testing」で起動する
# 普段使いの Google Chrome とは別アプリで動かし、Claude in Chrome 拡張機能と干渉しないようにする
# stdio の MCP サーバーのため、標準出力には MCP 以外の出力を出さない（ログは標準エラーへ）
set -eu

PLAYWRIGHT_MCP_VERSION="0.0.83"
# @playwright/mcp@0.0.83 が依存する playwright のバージョン
PLAYWRIGHT_VERSION="1.64.0-alpha-1790635538000"
BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"

# インストール済みの Chrome for Testing のうち、最も新しいものの実行ファイルを返す
find_chrome_for_testing() {
  for app in "$BROWSERS_DIR"/chromium-*/chrome-mac*/"Google Chrome for Testing.app"; do
    [ -d "$app" ] && echo "$app"
  done | sort -V | tail -n 1
}

APP="$(find_chrome_for_testing)"
if [ -z "$APP" ]; then
  echo "[playwright-mcp] Chrome for Testing が見つからないためインストールします" >&2
  npx -y "playwright@${PLAYWRIGHT_VERSION}" install chromium >&2
  APP="$(find_chrome_for_testing)"
fi
if [ -z "$APP" ]; then
  echo "[playwright-mcp] Chrome for Testing のインストールに失敗しました" >&2
  exit 1
fi

# --isolated: プロフィールをメモリ上に置き、終了後にディスクへ残さない
exec npx -y "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" \
  --executable-path "$APP/Contents/MacOS/Google Chrome for Testing" \
  --isolated \
  "$@"
