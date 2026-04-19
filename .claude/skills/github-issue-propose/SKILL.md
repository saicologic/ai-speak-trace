---
name: github-issue-propose
description: チャットで伝えた困りごとを整理し、確認後にGitHub Issueを新規作成する
disable-model-invocation: true
argument-hint: <困りごとの内容>
allowed-tools: Bash(gh issue create *) Bash(gh label *)
---

# GitHub Issue 作成

ユーザーが伝えた内容をもとにGitHub Issueを作成する。

## 入力内容

`$ARGUMENTS`

## 手順

1. ユーザーが伝えた内容を以下の形式で整理する
   - **タイトル**: 簡潔に1行で
   - **問題・要望**: 何に困っているか、何を実現したいか
   - **期待する動作**: どうなれば解決か
2. 整理した内容をユーザーに提示し「このIssueを作成しますか？」と確認する
3. OKされたら `gh issue create` でIssueを作成する

## Issue作成コマンド

```bash
gh issue create --title "タイトル" --body "$(cat <<'EOF'
## 問題・要望
（整理した内容）

## 期待する動作
（どうなれば解決か）

---
*このIssueは Claude Code `/github-issue-propose` により作成されました*
EOF
)"
```

## 重要な制約

- コードの変更は一切行わない
- ブランチの作成やPRの作成は行わない
- 必ずユーザーに確認してからIssueを作成する
