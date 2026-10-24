#!/usr/bin/env bash
# MCP サーバーを架空の会話で起動し、MCP Inspector の画面を Chrome で開く
# （ブラウザでツールを呼んで確かめるため。端末の実データは読まない）
#
# 使い方: cd backend && npm run mcp:inspect（Ctrl+C で止めると、架空のデータも消す）
set -euo pipefail

cd "$(dirname "$0")/.."

# 公開から2週間以上たった版に固定する
INSPECTOR_VERSION=2.9.0
INSPECTOR_PORT=6274

if lsof -nP -iTCP:"$INSPECTOR_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ポート $INSPECTOR_PORT を使っているプロセスがあります。MCP Inspector がすでに起動していないか確かめてください" >&2
  exit 1
fi

DEMO_DIR="$(mktemp -d -t ai-speak-trace-mcp-demo)"
LOG_FILE="$DEMO_DIR/inspector.log"
DATA_DIR="$DEMO_DIR/data"
INSPECTOR_PID=""

cleanup() {
  if [ -n "$INSPECTOR_PID" ]; then
    kill "$INSPECTOR_PID" 2>/dev/null || true
    wait "$INSPECTOR_PID" 2>/dev/null || true
  fi
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

npm run --silent mcp:build
node scripts/mcp-demo-data.js "$DATA_DIR"

# DATA_DIR は env で MCP サーバーに直接渡す（Inspector が渡す環境変数に左右されないように）
MCP_AUTO_OPEN_ENABLED=false npx -y "@modelcontextprotocol/inspector@$INSPECTOR_VERSION" --web \
  --transport stdio env DATA_DIR="$DATA_DIR" node dist/mcp/main.js >"$LOG_FILE" 2>&1 &
INSPECTOR_PID=$!

URL=""
for _ in $(seq 1 120); do
  URL="$(grep -Eo "http://127\.0\.0\.1:$INSPECTOR_PORT\?MCP_INSPECTOR_API_TOKEN=[0-9a-f]+" "$LOG_FILE" | head -1 || true)"
  [ -n "$URL" ] && break
  if ! kill -0 "$INSPECTOR_PID" 2>/dev/null; then
    cat "$LOG_FILE" >&2
    echo "MCP Inspector を起動できませんでした" >&2
    exit 1
  fi
  sleep 1
done
if [ -z "$URL" ]; then
  cat "$LOG_FILE" >&2
  echo "MCP Inspector の起動を待ちきれませんでした" >&2
  exit 1
fi

open -a "Google Chrome" "$URL"

cat <<EOF

MCP Inspector を Chrome で開きました（架空の会話: $DATA_DIR）
  $URL

画面で MCP サーバーにつなぐと、ツールを呼べます。
止めるときは Ctrl+C を押してください（架空のデータも消します）。
EOF

wait "$INSPECTOR_PID"
