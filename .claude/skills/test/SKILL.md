---
name: test
description: backend(Jest)/frontend(Vitest)のテスト実行。引数なしで全体、backend/frontendで個別実行
disable-model-invocation: true
argument-hint: [backend|frontend]
allowed-tools: Bash(cd backend *) Bash(cd frontend *)
---

# テスト実行

## 手順

引数が `backend` の場合:
```bash
cd backend && npm test
```

引数が `frontend` の場合:
```bash
cd frontend && npm run test:run
```

引数なしの場合、両方を順番に実行する。

## 結果報告

- テストが全て成功した場合: 成功した旨を簡潔に報告
- テストが失敗した場合: 失敗したテスト名とエラー内容を報告し、修正のヒントを提示
