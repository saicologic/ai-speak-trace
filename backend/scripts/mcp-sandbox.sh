#!/bin/sh
# MCP サーバーを sandbox（macOS の sandbox-exec）の中で起動する
# 外部への通信を禁止し、読めるのはデータのフォルダ・backend/・node だけ、書けるのは監査ログのフォルダだけにする
# （制限の内容は mcp-sandbox.sb）
#
# 使い方: mcp-sandbox.sh <node の絶対パス>
#   Claude Desktop などはシェルの PATH を使わないため、node は絶対パスで渡す
#   データのフォルダは環境変数 DATA_DIR で変えられる（既定はアプリのデータのフォルダ）
set -eu

if [ $# -ne 1 ]; then
  echo "使い方: $0 <node の絶対パス>" >&2
  exit 2
fi

# sandbox-exec はシンボリックリンクを解決したパスで比べるため、実際のパスにする
real() {
  (cd "$1" && pwd -P)
}

NODE=$1
NODE_REAL=$(real "$(dirname "$NODE")")/$(basename "$NODE")
# Homebrew などのシンボリックリンクの先（.../bin/node）から、node を入れたフォルダを求める
if [ -L "$NODE" ]; then
  LINK=$(readlink "$NODE")
  case "$LINK" in
    /*) NODE_REAL=$LINK ;;
    *) NODE_REAL=$(real "$(dirname "$NODE")/$(dirname "$LINK")")/$(basename "$LINK") ;;
  esac
fi
NODE_DIR=$(real "$(dirname "$NODE_REAL")/..")

BACKEND_DIR=$(real "$(dirname "$0")/..")
DATA_DIR=${DATA_DIR:-"$HOME/Library/Application Support/io.github.saicologic.ai-speak-trace/data"}
mkdir -p "$DATA_DIR/mcp-audit-logs"
DATA_DIR=$(real "$DATA_DIR")
HOME_DIR=$(real "$HOME")

export DATA_DIR
exec /usr/bin/sandbox-exec -f "$BACKEND_DIR/scripts/mcp-sandbox.sb" \
  -D HOME_DIR="$HOME_DIR" \
  -D DATA_DIR="$DATA_DIR" \
  -D BACKEND_DIR="$BACKEND_DIR" \
  -D NODE_DIR="$NODE_DIR" \
  "$NODE_REAL" "$BACKEND_DIR/dist/mcp/main.js"
