#!/usr/bin/env node
// playwright-navigate-gate.sh から呼ぶ。引数に pre・post と状態のフォルダ（~/.claude/state）、標準入力に hook の入力（JSON）を受け取る
// - pre: 判断（allow / ask / deny）を hook の出力（JSON）として標準出力に書く。ask にした呼び出しを tool_use_id ごとに記録する
// - post: 開く前に ask にした呼び出しだけ、そのサイトを一覧に足す（標準出力には何も書かない。足せないときは標準エラーに書いて 1 で終える）
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [mode, stateDir] = process.argv.slice(2)
const listPath = join(stateDir, 'playwright-allowed-origins')
const pendingDir = join(stateDir, 'playwright-navigate-pending')

/** 初めから許可するサイト（開発用の画面） */
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
/** 確かめたまま開かなかった呼び出しの記録を消すまでの時間 */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000

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

/** tool_use_id をファイル名にしてよい形のときだけ返す */
function pendingPath(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? join(pendingDir, id) : null
}

/** 確かめたまま開かなかった（拒否された）呼び出しの古い記録を消す */
function prunePending() {
  let names
  try {
    names = readdirSync(pendingDir)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    try {
      const file = join(pendingDir, name)
      if (now - statSync(file).mtimeMs > PENDING_TTL_MS) unlinkSync(file)
    } catch {
      // 消せなかった記録は、次に動いたときにもう一度消す
    }
  }
}

/** 一覧の最後に足す。最後の行に改行がないときは、先に改行を足す（行がつながらないように） */
function appendOrigin(origin) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  let prefix = ''
  try {
    const text = readFileSync(listPath, 'utf-8')
    if (text.length > 0 && !text.endsWith('\n')) prefix = '\n'
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  appendFileSync(listPath, `${prefix}${origin}\n`, { mode: 0o600 })
}

const decision = (permissionDecision, permissionDecisionReason) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } })

const input = JSON.parse(readFileSync(0, 'utf-8'))
const allowed = () => new Set([...DEFAULT_ORIGINS, ...readList()])

if (mode === 'pre') {
  const { origin, reason } = originOf(input.tool_input?.url)
  if (!origin) {
    process.stdout.write(decision('deny', `${reason}のため開きません。Playwright MCP では http・https のサイトだけを開きます`))
  } else if (allowed().has(origin)) {
    process.stdout.write(decision('allow', `許可したサイト（${origin}）`))
  } else {
    const file = pendingPath(input.tool_use_id)
    let recorded = false
    if (file) {
      try {
        mkdirSync(pendingDir, { recursive: true, mode: 0o700 })
        writeFileSync(file, origin, { mode: 0o600 })
        recorded = true
      } catch {
        // 記録できなくても確認は出す（開いた後に一覧へ足さないだけ）
      }
    }
    process.stdout.write(
      decision(
        'ask',
        recorded
          ? `初めて開くサイト（${origin}）です。許可すると一覧（~/.claude/state/playwright-allowed-origins）に足し、次からは確認しません`
          : `初めて開くサイト（${origin}）です。確認の記録を残せなかったため、許可すると今回は開けますが、次回も確認します`,
      ),
    )
  }
  prunePending()
} else if (mode === 'post') {
  const file = pendingPath(input.tool_use_id)
  let origin = null
  if (file) {
    try {
      origin = readFileSync(file, 'utf-8').trim()
      unlinkSync(file)
    } catch {
      origin = null
    }
  }
  // 開く前に ask にした呼び出しだけ足す（記録したオリジンを、もう一度読み直してから足す）
  // 開いた URL のオリジンが記録と違う（ほかの hook が入力を書き換えたなど）ときは、どちらも足さない
  const checked = origin ? originOf(origin).origin : null
  const opened = originOf(input.tool_input?.url).origin
  if (checked && checked === opened && !allowed().has(checked)) {
    try {
      appendOrigin(checked)
    } catch (error) {
      process.stderr.write(
        `許可したサイトの一覧に足せませんでした（${listPath}: ${error.message}）。ページは開いています。次も確認が出ます。一覧のファイルを直すか、${checked} の行を自分で足してください\n`,
      )
      process.exit(1)
    }
  }
}
