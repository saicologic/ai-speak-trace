---
name: github-issue-propose
description: チャットで伝えた困りごとを整理し、確認後にGitHub Issueを新規作成する
disable-model-invocation: true
argument-hint: <困りごとの内容>
allowed-tools: Bash(/opt/claude-code-team/bin/github.sh issue create *) Write
---

# GitHub Issue 作成

ユーザーが伝えた内容をもとにGitHub Issueを作成する。

## 入力内容

`$ARGUMENTS`

## 手順

1. ユーザーが伝えた内容を以下の形式で整理する
   - **タイトル**: `<prefix>: <内容>する` の形式で1行で（prefix は feat / fix / docs / chore から選ぶ）
   - **問題・要望**: 何に困っているか、何を実現したいか
   - **期待する動作**: どうなれば解決か
2. 整理した内容をユーザーに提示し「このIssueを作成しますか？」と確認する
3. OKされたら、本文をスクラッチパッドのファイルに Write で書き、`github.sh issue create` でIssueを作成する
   （GitHub には、サンドボックスの外で動く `/opt/claude-code-team/bin/github.sh` からつなぐ。`docs/developers/claude-code-sandbox.md`）

## Issueの本文（ファイルに書く）

```markdown
## 問題・要望
（整理した内容）

## 期待する動作
（どうなれば解決か）

---
*このIssueは Claude Code `/github-issue-propose` により作成されました*
```

## Issue作成コマンド

```bash
/opt/claude-code-team/bin/github.sh issue create --title "タイトル" --body-file <本文のファイル>
```

## 重要な制約

- コードの変更は一切行わない
- ブランチの作成やPRの作成は行わない
- 必ずユーザーに確認してからIssueを作成する
