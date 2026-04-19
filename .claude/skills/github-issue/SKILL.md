---
name: github-issue
description: GitHub Issueを分析し修正提案をIssueコメントとして投稿。コード変更は行わず提案のみ
disable-model-invocation: true
context: fork
agent: Explore
argument-hint: <issue-number>
allowed-tools: Bash(gh issue view *) Bash(gh issue comment *) Glob Read Grep
---

# GitHub Issue 分析・提案

Issue #$ARGUMENTS の内容を分析し、修正提案をIssueコメントとして投稿する。

## Issue情報

- Issue内容: !`gh issue view $ARGUMENTS`
- Issueコメント: !`gh issue view $ARGUMENTS --comments 2>/dev/null || echo "コメントなし"`

## 手順

1. Issue内容とコメントのやり取りを読み、問題の本質を把握する
2. Glob と Grep で関連するコードファイルを検索する
3. Read で関連ファイルの実装を確認する
4. 依存関係やデータフローを追跡し、影響範囲を特定する
5. 修正提案を以下のテンプレートに従って作成する
6. `gh issue comment $ARGUMENTS --body "..."` でIssueにコメントとして投稿する

## コメントテンプレート

以下の形式で日本語のコメントを投稿する:

```
> **Claude Code** による自動分析です

## 修正提案

### 問題の概要
（Issueの内容を分析した結果、何が問題かを簡潔に説明）

### 関連ファイル
| ファイル | 役割 | 変更の必要性 |
|---------|------|-------------|
| `path/to/file` | 説明 | 高/中/低 |

### 修正方針
1. **ステップ1**: 具体的な変更内容
2. **ステップ2**: 具体的な変更内容

### 考慮事項
- （副作用やリスクがあれば記載）
- （テストで確認すべきポイント）

---
*この提案は Claude Code `/github-issue` により自動生成されました*
```

## 重要な制約

- コードの変更は一切行わない
- ブランチの作成やPRの作成は行わない
- 出力は必ず `gh issue comment` でIssueコメントとして投稿する
