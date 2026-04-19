---
name: github-release
description: GitHubリリース作成。タグとリリースノートを自動生成してGitHubリリースを公開する
disable-model-invocation: true
argument-hint: <version>
allowed-tools: Bash(git *) Bash(gh *)
---

# GitHubリリース作成

バージョン `$ARGUMENTS` のGitHubリリースを作成する。

## 事前情報

- 現在のブランチ: !`git branch --show-current`
- 最新タグ: !`git tag --sort=-v:refname | head -1`
- タグ $ARGUMENTS の存在確認: !`git tag -l "$ARGUMENTS"`

## 手順

1. 現在のブランチが `main` であることを確認（main以外の場合はユーザーに報告して中止）
2. タグ `$ARGUMENTS` が既に存在する場合はユーザーに報告して中止
3. 最新タグからHEADまでの差分コミットを `git log <最新タグ>..HEAD --oneline` で取得
4. 変更内容を以下のカテゴリに分類:
   - バグ修正（fix:）
   - 機能追加（feat:）
   - ドキュメント・テスト（docs:, test:）
   - その他
5. タグを作成: `git tag $ARGUMENTS`
6. タグをプッシュ: `git push origin $ARGUMENTS`
7. 以下のテンプレートに従ってGitHubリリースを作成

## リリースノートテンプレート

`gh release create $ARGUMENTS --title "$ARGUMENTS" --notes` の内容:

```markdown
## 変更内容

### バグ修正
- （fix: コミットを箇条書き、PR番号があれば付与）

### 機能追加
- （feat: コミットを箇条書き、PR番号があれば付与）

### ドキュメント・テスト
- （docs:, test: コミットを箇条書き）
```

※ 該当カテゴリがない場合はそのセクションを省略する
