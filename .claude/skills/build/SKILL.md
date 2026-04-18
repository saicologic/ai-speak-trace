---
name: build
description: backend(NestJS)/frontend(Vite)のビルド確認。ビルドエラーの検出と報告を行う
disable-model-invocation: true
allowed-tools: Bash(cd backend *) Bash(cd frontend *)
---

# ビルド確認

## 手順

1. バックエンドビルド:
```bash
cd backend && npm run build
```

2. フロントエンドビルド:
```bash
cd frontend && npm run build
```

3. ビルド結果を報告

## 結果報告

- 成功: ビルド成功を簡潔に報告
- 失敗: エラー内容を報告し、修正のヒントを提示

## 補足

- フルビルド（DMG生成）が必要な場合はルートの `npm run build` を実行
- 通常の確認では backend/frontend 個別ビルドで十分
