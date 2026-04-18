---
name: audit
description: npm脆弱性チェックと修正提案。依存パッケージ更新時やセキュリティ確認時に使用
disable-model-invocation: true
allowed-tools: Bash(cd backend *) Bash(cd frontend *)
---

# 脆弱性チェック

## 現在の状態

- Backend: !`cd backend && npm audit 2>/dev/null | tail -5 || echo "確認中..."`
- Frontend: !`cd frontend && npm audit 2>/dev/null | tail -5 || echo "確認中..."`

## 手順

1. `cd backend && npm audit` を実行
2. `cd frontend && npm audit` を実行
3. 結果を重大度別（critical/high/moderate/low）に報告
4. `npm audit fix` で自動修正可能か確認
5. 修正が必要な場合は対応手順を提案

## 脆弱性が見つかった場合のPRテンプレート

```markdown
## Summary
- （修正内容を記載）

## Test plan
- [ ] `cd backend && npm audit` で脆弱性が0件であること
- [ ] `cd frontend && npm audit` で脆弱性が0件であること
```
