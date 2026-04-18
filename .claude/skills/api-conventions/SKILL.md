---
name: api-conventions
description: NestJSバックエンドのAPI設計規約とモジュール構成パターン。新しいコントローラやサービスを作成する際に自動適用
user-invocable: false
paths: backend/src/**
---

## モジュール構成

各機能はモジュール単位でディレクトリを分ける:

```
backend/src/<module>/
├── <module>.controller.ts    # エンドポイント定義
├── <module>.service.ts       # ビジネスロジック
├── <module>.module.ts        # NestJSモジュール（必要な場合）
├── dto/                      # リクエスト/レスポンスDTO
├── types/                    # 型定義
└── <module>.utils.spec.ts    # テスト
```

## 規約

- サービスは単一責任で分割する（例: `transcription.service.ts` と `elevenlabs.service.ts`）
- 外部API呼び出しは専用のサービスに分離する
- ストレージ操作は `storage/` の抽象化層を使用する
- テストファイルは `*.spec.ts` で対象ファイルと同じディレクトリに配置
- `app.module.ts` に新しいモジュールを登録する
