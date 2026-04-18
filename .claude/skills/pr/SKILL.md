---
name: pr
description: PRの差分を分析しサマリーを生成。PRレビュー前の確認やPR説明文の作成時に使用
disable-model-invocation: true
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

# PRサマリー生成

## PR情報

- PR差分: !`gh pr diff 2>/dev/null || echo "PRが見つかりません。先にPRを作成してください"`
- PRコメント: !`gh pr view --comments 2>/dev/null || echo ""`
- 変更ファイル: !`gh pr diff --name-only 2>/dev/null || echo ""`

## タスク

上記のPR情報を分析し、以下を日本語でまとめる:

1. **変更概要**: 何を変更したかを簡潔に説明
2. **変更ファイル一覧**: カテゴリ別に整理（backend/frontend/CI/docs等）
3. **影響範囲**: この変更が影響する機能や画面
4. **レビューポイント**: レビュアーが特に注目すべき箇所
