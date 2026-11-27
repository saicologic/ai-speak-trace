---
name: release
description: 版上げのPR作成。main に tauri.conf.json の version を上げる PR（題は release: vX.Y.Z）を作る際に使用
disable-model-invocation: true
argument-hint: <version>
allowed-tools: Bash(git *)
---

# 版上げのPR作成

バージョン `$ARGUMENTS`（`X.Y.Z` の形。先頭の `v` は付けない）の版上げの PR を `main` に作る。
リリースの流れは CLAUDE.md の「リリース手順」に従う（`release/vX.Y.Z` はマージの後にユーザーが `main` から切る）。

## 事前情報

- 現在のブランチ: !`git branch --show-current`
- 前のタグ: !`git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "タグなし"`

## 手順

1. `/opt/claude-code-team/bin/github.sh fetch origin main` で `main` を取り、`origin/main` から `fix/release-v$ARGUMENTS` を作る
2. `src-tauri/tauri.conf.json` の `version` を `$ARGUMENTS` にし、`release: v$ARGUMENTS` でコミットする
3. `git log --oneline <前のタグ>..origin/main` で、リリースに入る変更を一覧にし、思わぬコミットがないかを確かめる
   - 新機能が入っていればマイナー、修正だけならパッチの番号になっているかを確かめる（違えばユーザーに伝える）
4. 変更内容をカテゴリ別に整理（機能追加、バグ修正、CI/CD、ドキュメントなど）し、下のテンプレートで本文をスクラッチパッドのファイルに書く
5. 本文をユーザーに見せて確かめてから、push と PR の作成をする
   - `/opt/claude-code-team/bin/github.sh push -u origin HEAD:refs/heads/fix/release-v$ARGUMENTS`
   - `/opt/claude-code-team/bin/github.sh pr create --draft --base main --title "release: v$ARGUMENTS" --body-file <ファイル>`
   - 版上げだけでテストを書けないため、`no-tdd` のラベルを付ける
6. マージの後にユーザーがすることを伝える: `main` から `release/v$ARGUMENTS` を切って push する → ドラフトのリリースの DMG を確かめて公開する

## PRテンプレート

`## 変更内容` はリリースノートに使われる（`release.yml` が題 `release: vX.Y.Z` の PR から読む）。
リリースの後に本文を直すときは、ドラフトの本文ではなく、この PR の本文を直して `release.yml` を動かし直す。

```markdown
## 変更内容
- （変更内容をカテゴリ別に箇条書き）

## 手動確認項目
- [ ] `release/v$ARGUMENTS` を push して、タグ `v$ARGUMENTS` とドラフトのリリースができること
- [ ] ドラフトの DMG を入れて、起動できること
```
