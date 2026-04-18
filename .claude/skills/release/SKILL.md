---
name: release
description: リリースPR作成。リリースブランチからmainへのPRをテストプラン付きで作成する際に使用
disable-model-invocation: true
argument-hint: <version>
allowed-tools: Bash(git *) Bash(gh *)
---

# リリースPR作成

バージョン `$ARGUMENTS` のリリースPRを作成する。

## 事前情報

- 現在のブランチ: !`git branch --show-current`
- mainとの差分コミット: !`git log main..HEAD --oneline 2>/dev/null || echo "mainブランチとの差分なし"`

## 手順

1. 現在のブランチが `release/$ARGUMENTS` でない場合、`release/$ARGUMENTS` ブランチを作成してチェックアウト
2. `git log main..HEAD --oneline` でリリースに含まれる変更を一覧化
3. 変更内容をカテゴリ別に整理（機能追加、バグ修正、CI/CD、ドキュメントなど）
4. 以下のテンプレートに従ってPRを作成

## PRテンプレート

```markdown
## Summary
- （変更内容をカテゴリ別に箇条書き）

## Test plan

### CI自動チェック（PRのChecksタブで確認）
- [ ] `backend-test` がパスしていること
- [ ] `frontend-test` がパスしていること

### 手動確認
- [ ] `npm run build` でビルドが成功すること
- [ ] リリースに含まれる変更が正しいこと
```
