---
name: fix-issue
description: GitHub Issueの修正フロー。fix/ブランチ作成から修正、テスト実行、PR作成まで一連の流れを実行する
disable-model-invocation: true
argument-hint: <issue-number>
allowed-tools: Bash(git *) Bash(gh *) Bash(cd backend *) Bash(cd frontend *)
---

# GitHub Issue 修正

Issue #$ARGUMENTS を修正する。

## 手順

1. `gh issue view $ARGUMENTS` でIssue内容を確認し、修正方針を決定
2. `fix/issue-$ARGUMENTS` ブランチを作成
3. 修正を実施
4. 関連するテストを実行して確認
   - backend変更: `cd backend && npm test`
   - frontend変更: `cd frontend && npm run test:run`
5. コミットメッセージを作成してコミット
6. 以下のテンプレートに従ってPRを作成

## PRテンプレート

```markdown
## Summary
- （修正内容を簡潔にまとめる）
- Closes #$ARGUMENTS

## Test plan

### CI自動チェック（PRのChecksタブで確認）
- [ ] `backend-test` がパスしていること
- [ ] `frontend-test` がパスしていること

### 手動確認
- [ ] （変更内容に応じた確認項目を記載）
```
