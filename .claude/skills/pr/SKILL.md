---
name: pr
description: PRの差分を分析しサマリーを生成。PRレビュー前の確認やPR説明文の作成時に使用
disable-model-invocation: true
context: fork
agent: Explore
allowed-tools: Bash(/opt/claude-code-team/bin/github.sh pr *)
---

# PRサマリー生成

## PR情報

GitHub には、サンドボックスの外で動く `/opt/claude-code-team/bin/github.sh` からつなぐ（`docs/developers/claude-code-sandbox.md`）。
PR がまだないときは、下の出力がエラーになる。そのときは、先に PR を作るよう伝える。

- PR差分: !`/opt/claude-code-team/bin/github.sh pr diff`
- PRコメント: !`/opt/claude-code-team/bin/github.sh pr view --comments`
- 変更ファイル: !`/opt/claude-code-team/bin/github.sh pr diff --name-only`

## タスク

上記のPR情報を分析し、以下を日本語でまとめる:

1. **変更概要**: 何を変更したかを簡潔に説明
2. **変更ファイル一覧**: カテゴリ別に整理（backend/frontend/CI/docs等）
3. **影響範囲**: この変更が影響する機能や画面
4. **レビューポイント**: レビュアーが特に注目すべき箇所
