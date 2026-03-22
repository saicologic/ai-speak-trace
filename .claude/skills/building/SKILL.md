---
name: building
description: バックエンドバイナリのパッケージングからTauriアプリのビルド、DMG生成までを一括実行します。ビルドやアプリのパッケージングについて言及された場合に使用してください。
disable-model-invocation: true
argument-hint: "[check]"
---

# フルビルド

## 使い方

- `/building` — フルビルド（arm64）を実行する
- `/building check` — 事前チェックのみ（`node_modules`・`cargo` の存在確認）

## 手順

1. 事前チェック: `frontend/node_modules`、`backend/node_modules`、`cargo --version`
2. `cd backend && npm run pkg:mac-arm64`（バイナリ → `src-tauri/binaries/`）
3. `tauri build`（フロントエンドも `beforeBuildCommand` で自動ビルド）
4. `src-tauri/target/release/bundle/dmg/` のDMGファイル名を報告

ルートの `npm run build` で2〜4を一括実行も可能。ビルドは数分かかるためタイムアウトに注意。
