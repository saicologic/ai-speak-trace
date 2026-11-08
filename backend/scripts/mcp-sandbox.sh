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

# node の実体のパス（多段のシンボリックリンクもたどる。nvm・asdf などで起こる）
NODE=$1
NODE_REAL=$NODE
HOPS=0
while [ -L "$NODE_REAL" ] && [ $HOPS -lt 40 ]; do
  HOPS=$((HOPS + 1))
  LINK=$(readlink "$NODE_REAL")
  case "$LINK" in
    /*) NODE_REAL=$LINK ;;
    *) NODE_REAL=$(dirname "$NODE_REAL")/$LINK ;;
  esac
done
if [ ! -f "$NODE_REAL" ] || [ ! -x "$NODE_REAL" ]; then
  echo "node を実行できません: $NODE（node の絶対パスを渡してください）" >&2
  exit 2
fi
NODE_REAL=$(real "$(dirname "$NODE_REAL")")/$(basename "$NODE_REAL")
# node を入れたフォルダ（.../bin/node の2つ上）
NODE_DIR=$(real "$(dirname "$NODE_REAL")/..")
HOME_DIR=$(real "$HOME")
# node のフォルダがホームフォルダそのもの、またはその親だと、ホームフォルダ全体を読めてしまう
case "$HOME_DIR/" in
  "$NODE_DIR"/*)
    echo "node のフォルダ（$NODE_DIR）がホームフォルダを含むため、sandbox で読み取りを制限できません。node を別の場所に入れてください" >&2
    exit 2
    ;;
esac

BACKEND_DIR=$(real "$(dirname "$0")/..")
DATA_DIR=${DATA_DIR:-"$HOME/Library/Application Support/io.github.saicologic.ai-speak-trace/data"}
mkdir -p "$DATA_DIR/mcp-audit-logs"
DATA_DIR=$(real "$DATA_DIR")

# 起動せずに、sandbox に渡す値を表示する（テスト・確かめる用）
if [ "${MCP_SANDBOX_DRY_RUN:-}" = 1 ]; then
  printf 'HOME_DIR=%s\nDATA_DIR=%s\nBACKEND_DIR=%s\nNODE_DIR=%s\nNODE=%s\n' \
    "$HOME_DIR" "$DATA_DIR" "$BACKEND_DIR" "$NODE_DIR" "$NODE_REAL"
  exit 0
fi

export DATA_DIR
exec /usr/bin/sandbox-exec -f "$BACKEND_DIR/scripts/mcp-sandbox.sb" \
  -D HOME_DIR="$HOME_DIR" \
  -D DATA_DIR="$DATA_DIR" \
  -D BACKEND_DIR="$BACKEND_DIR" \
  -D NODE_DIR="$NODE_DIR" \
  "$NODE_REAL" "$BACKEND_DIR/dist/mcp/main.js"
