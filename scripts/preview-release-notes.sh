#!/bin/bash
# リリースノートのプレビュー確認用スクリプト
# 使い方: ./scripts/preview-release-notes.sh v0.5.9

set -e

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "使い方: $0 <タグ名>"
  echo "例: $0 v0.5.9"
  exit 1
fi

VERSION="${TAG#v}"
REPO="saicologic/ai-speak-trace"

echo "=== リリースノートプレビュー: ${TAG} ==="
echo ""

PR_BODY=$(gh pr list \
  --repo "$REPO" \
  --state merged \
  --search "release: v${VERSION} in:title" \
  --json body \
  --jq '.[0].body // ""')

CHANGES=$(echo "$PR_BODY" | awk '/^## 変更内容/{found=1; next} found && /^## /{exit} found{print}')

if [ -z "$CHANGES" ]; then
  echo "エラー: release: v${VERSION} のPRが見つからないか、「## 変更内容」セクションがありません" >&2
  exit 1
fi

cat <<EOF
## 変更内容
${CHANGES}

## インストール方法
DMGファイルをダウンロードしてマウントし、アプリケーションフォルダにドラッグしてください。
EOF
