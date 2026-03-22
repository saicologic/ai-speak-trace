---
name: bumping-version
description: 複数ファイルに散らばるバージョン番号を一括更新します。バージョンの変更やバージョンアップについて言及された場合に使用してください。
---

# バージョン一括更新

## 使い方

- `/bumping-version X.Y.Z` — 指定バージョンに更新する（`v` プレフィックスは自動除去）

## 更新対象ファイル

| ファイル | フィールド |
|---------|-----------|
| `src-tauri/tauri.conf.json` | `"version"` |
| `backend/package.json` | `"version"` |
| `frontend/package.json` | `"version"` |

## 手順

1. `X.Y.Z` 形式であることをバリデーション
2. 各ファイルの現在のバージョンをユーザーに表示
3. 3ファイルすべてを Edit ツールで更新
4. 更新前後の一覧と `git diff` を表示

コミットは自動で行わない。ダウングレード時は警告を表示する。
