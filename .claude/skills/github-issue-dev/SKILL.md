---
name: github-issue-dev
description: GitHub Issue番号を指定して開発を開始。最新mainからブランチを作成し、修正・テスト・PR作成まで実行
disable-model-invocation: true
argument-hint: <issue-number>
allowed-tools: Bash(git *) Bash(gh *) Bash(cd backend *) Bash(cd frontend *)
---

# GitHub Issue 開発

Issue #$ARGUMENTS の内容をもとに開発する。

## Issue情報

- Issue内容: !`gh issue view $ARGUMENTS`
- Issueコメント: !`gh issue view $ARGUMENTS --comments 2>/dev/null || echo "コメントなし"`
- Issueラベル: !`gh issue view $ARGUMENTS --json labels --jq '.labels[].name' 2>/dev/null || echo "ラベルなし"`

## 手順

1. Issue内容とコメントのやり取りをすべて読み、修正方針を決定する
2. Issueに開発開始のコメントを投稿する
   ```bash
   gh issue comment $ARGUMENTS --body "> **Claude Code** が開発を開始します"
   ```
3. 最新のmainブランチを取得してブランチを作成する
   ```bash
   git fetch origin main
   git checkout -b <ブランチ名> origin/main
   ```
3. 修正を実施する
4. 関連するテストを実行して確認する
   - backend変更: `cd backend && npm test`
   - frontend変更: `cd frontend && npm run test:run`
5. コミットメッセージを作成してコミットする
6. 以下のルールに従ってPRを作成する

## ブランチ名の決定

Issueの内容・ラベルから種別を判定し、ブランチ名を決定する:

- バグ修正 → `fix/issue-$ARGUMENTS`
- 新機能 → `feature/issue-$ARGUMENTS`
- リリース → `release/issue-$ARGUMENTS`

## PRテンプレート

ブランチ種別に応じたテンプレートを使用する。

### fix/* または feature/* の場合

```markdown
## Summary
- （修正・実装内容を簡潔にまとめる）
- Closes #$ARGUMENTS

## Test plan

### CI自動チェック（PRのChecksタブで確認）
- [ ] `backend-test` がパスしていること
- [ ] `frontend-test` がパスしていること

### 手動確認
- [ ] （変更内容に応じた確認項目を記載）
```

### release/* の場合

```markdown
## Summary
- （変更内容をカテゴリ別に箇条書き）
- Closes #$ARGUMENTS

## Test plan

### CI自動チェック（PRのChecksタブで確認）
- [ ] `backend-test` がパスしていること
- [ ] `frontend-test` がパスしていること

### 手動確認
- [ ] `npm run build` でビルドが成功すること
- [ ] リリースに含まれる変更が正しいこと
```
