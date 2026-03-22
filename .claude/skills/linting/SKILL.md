---
name: linting
description: フロントエンドとバックエンドのESLintを一括実行し、結果をまとめて報告します。リントや静的解析について言及された場合に使用してください。
disable-model-invocation: true
argument-hint: "[frontend | backend]"
---

# リント一括実行

## 使い方

- `/linting` — フロントエンド・バックエンド両方
- `/linting frontend` — フロントエンドのみ
- `/linting backend` — バックエンドのみ

## 実行コマンド

- フロントエンド: `cd frontend && npm run lint`
- バックエンド: `cd backend && npm run lint`

両方実行する場合は並列で実行する。エラーがあれば修正案を提示する。
