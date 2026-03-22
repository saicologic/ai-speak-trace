---
name: creating-pr
description: CLAUDE.mdのTest plan形式に準拠したPRを作成します。PRの作成やプルリクエストについて言及された場合に使用してください。
disable-model-invocation: true
argument-hint: "[補足説明]"
---

# PR作成

## 使い方

- `/creating-pr` — 現在のブランチからPRを作成する
- `/creating-pr 引数` — 引数をPRの補足説明として使用する

## 手順

1. 現在のブランチを確認（`main` や `release/vX.Y.Z` ならエラー）
2. ベースブランチを判定（`release/vX.Y.Z` があればそれ、なければ `main`）
3. `git log` と `git diff` で全コミットの差分を分析
4. ユーザーに確認後、`gh pr create` で作成

## PR本文テンプレート

```markdown
## Summary
- （変更内容を1〜3行の箇条書き）

## Test plan

`npm run dev:app` で起動し、Tauriウィンドウ上で以下を確認:

- [ ] （具体的な確認項目。「〇〇画面で△△ボタンを押すと□□が表示される」のように）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## ルール

- PRタイトルは70文字以内、日本語で記述
- プッシュ前にリモートとの差分を確認する
