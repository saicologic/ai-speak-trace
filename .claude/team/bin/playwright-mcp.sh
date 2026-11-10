#!/bin/sh
# Playwright MCP を「Google Chrome for Testing」で起動する
# 普段使いの Google Chrome（ログイン中のサービスがある）とは別アプリで動かす
# ブラウザは localhost の開発用の画面だけを開く（つながらないプロキシを通し、localhost・127.0.0.1 だけを例外にする）
# stdio の MCP サーバーのため、標準出力には MCP 以外の出力を出さない（ログは標準エラーへ）
#
# インストール先（/opt/claude-code-team/bin）から、managed-mcp.json で、これだけを MCP サーバーとして動かす。
# MCP サーバーはサンドボックスの外で動き、Claude Code の環境変数を引き継ぐため:
# - 受け取った環境変数は使わない（PATH・HOME は決めた値・アカウントの情報から作り、npx は env -i で動かす）
# - 受け取った引数は Playwright MCP に渡さない
# - 作業フォルダの node_modules を使わないよう、/ に移ってから npx を動かす
# テスト: bash .claude/team/tests/playwright-mcp.test.sh
set -eu

PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PATH
user="$(/usr/bin/id -un)"
home="$(/usr/bin/dscl . -read "/Users/$user" NFSHomeDirectory | /usr/bin/sed -e 's/^NFSHomeDirectory: //' -e 1q)"
[ -d "$home" ] || { echo "[playwright-mcp] ホームフォルダが見つかりません" >&2; exit 1; }

PLAYWRIGHT_MCP_VERSION="0.0.83"
# @playwright/mcp@0.0.83 が依存する playwright のバージョン
PLAYWRIGHT_VERSION="1.64.0-alpha-1790635538000"
BROWSERS_DIR="$home/Library/Caches/ms-playwright"

# インストール済みの Chrome for Testing のうち、最も新しいものの実行ファイルを返す
find_chrome_for_testing() {
  for app in "$BROWSERS_DIR"/chromium-*/chrome-mac*/"Google Chrome for Testing.app"; do
    [ -d "$app" ] && echo "$app"
  done | sort -V | tail -n 1
}

cd /

APP="$(find_chrome_for_testing)"
if [ -z "$APP" ]; then
  echo "[playwright-mcp] Chrome for Testing が見つからないためインストールします" >&2
  /usr/bin/env -i PATH="$PATH" HOME="$home" USER="$user" LOGNAME="$user" \
    npx -y "playwright@${PLAYWRIGHT_VERSION}" install chromium >&2
  APP="$(find_chrome_for_testing)"
fi
if [ -z "$APP" ]; then
  echo "[playwright-mcp] Chrome for Testing のインストールに失敗しました" >&2
  exit 1
fi

# 決めた環境変数だけで動かす。--isolated: プロフィールをメモリ上に置き、終了後にディスクへ残さない
# --proxy-server・--proxy-bypass: 127.0.0.1:9 は使っていないポート。localhost・127.0.0.1 以外への通信は、ここで失敗する
# --config: Chrome の起動引数で、プロキシを通らない WebRTC の UDP を止める（etc/playwright-mcp.json）
exec /usr/bin/env -i PATH="$PATH" HOME="$home" USER="$user" LOGNAME="$user" npx -y "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" \
  --executable-path "$APP/Contents/MacOS/Google Chrome for Testing" \
  --isolated \
  --proxy-server "http://127.0.0.1:9" \
  --proxy-bypass "localhost,127.0.0.1" \
  --config "/opt/claude-code-team/etc/playwright-mcp.json"
