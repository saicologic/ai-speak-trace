---
name: releasing
description: リリースブランチの作成、release→mainのPR作成、gitタグとGitHub Releaseの作成を行います。リリース作業やバージョンのリリースについて言及された場合に使用してください。
---

# リリースブランチ管理

ブランチ運用ルールは MEMORY.md / branching.md を参照。

## サブコマンド

- `/releasing create vX.Y.Z` — mainから `release/vX.Y.Z` を作成し、リモートにpush
- `/releasing pr` — 現在の `release/vX.Y.Z` → main のPRを作成
- `/releasing tag vX.Y.Z` — mainで `git tag` + `gh release create`

## `pr` のPR本文形式

```
タイトル: release vX.Y.Z
本文:
## Summary
- release/vX.Y.Z を main にマージするリリースPR

## 含まれるPR
（`gh pr list --base release/vX.Y.Z --state merged` で取得して記載）
```
