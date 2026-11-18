#!/usr/bin/env node
// playwright-navigate-gate.sh から呼ぶ。標準入力に hook の入力（JSON）、引数に許可したサイトの一覧のファイルを受け取る
// - PreToolUse: 判断（allow / ask / deny）を hook の出力（JSON）として標準出力に書く
// - PostToolUse: 開けたサイトが一覧になければ足す（標準出力には何も書かない）
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const listPath = process.argv[2]
const input = JSON.parse(readFileSync(0, 'utf-8'))

/** 初めから許可するサイト（開発用の画面） */
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * URL からオリジン（scheme://host:port）を取り出す。ブラウザと同じ決まり（WHATWG URL）で読み、大文字・既定のポートをまとめる
 * サイトではない URL（file:・data:・javascript: など）と、ユーザー名・パスワードの付いた URL は、理由を返す
 */
function originOf(raw) {
  let url
  try {
    url = new URL(String(raw ?? ''))
  } catch {
    return { reason: '読み取れない URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { reason: `サイトではない URL（${url.protocol}）` }
  }
  // http://localhost:5173@evil.example/ のように、localhost に見せかけて別のホストを開けるため
  if (url.username || url.password) return { reason: 'ユーザー名・パスワードの付いた URL' }
  return { origin: url.origin }
}

/** 許可したサイトの一覧（ファイルがないときは空） */
function readList() {
  let text
  try {
    text = readFileSync(listPath, 'utf-8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => originOf(line).origin)
    .filter(Boolean)
}

const decision = (permissionDecision, permissionDecisionReason) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } })

const { origin, reason } = originOf(input.tool_input?.url)
const allowed = new Set([...DEFAULT_ORIGINS, ...readList()])

if (input.hook_event_name === 'PreToolUse') {
  if (!origin) {
    process.stdout.write(decision('deny', `${reason}のため開きません。Playwright MCP では http・https のサイトだけを開きます`))
  } else if (allowed.has(origin)) {
    process.stdout.write(decision('allow', `許可したサイト（${origin}）`))
  } else {
    process.stdout.write(
      decision('ask', `初めて開くサイト（${origin}）です。許可すると一覧（~/.claude/state/playwright-allowed-origins）に足し、次からは確認しません`),
    )
  }
} else if (input.hook_event_name === 'PostToolUse' && origin && !allowed.has(origin)) {
  mkdirSync(dirname(listPath), { recursive: true, mode: 0o700 })
  appendFileSync(listPath, `${origin}\n`, { mode: 0o600 })
}
