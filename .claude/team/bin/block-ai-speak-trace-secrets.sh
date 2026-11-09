#!/bin/bash
# AI Speak Trace の API キーが Claude Code の会話ログに出力されないよう、
# キーを含む設定ファイル・API・項目名に触れる Bash コマンドを実行前に拒否する
# （managed settings の PreToolUse / Bash の hook。インストール先 /opt/claude-code-team/bin で動く）
# テスト: bash .claude/team/tests/block-secrets.test.sh
cmd=$(jq -r '.tool_input.command // empty')
pattern='api/settings|anthropicApiKey|elevenlabsApiKey|apiKeys|io\.github\.saicologic\.ai-speak-trace/settings\.json|sk-ant-|ANTHROPIC_API_KEY=\$\('
if printf '%s' "$cmd" | grep -Eq "$pattern"; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "AI Speak Trace の API キーが会話ログに出る可能性があるコマンドのため拒否しました（設定ファイル・/api/settings・キー項目名）。キーを表示しない方法（アプリ経由、または環境変数を事前に設定）を使ってください。"}}'
fi
exit 0
