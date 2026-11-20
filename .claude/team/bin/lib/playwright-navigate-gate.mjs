#!/usr/bin/env node
// playwright-navigate-gate.sh から呼ぶ（browser_navigate と、URL を渡した browser_tabs）。引数に pre・post と状態のフォルダ（~/.claude/state）、標準入力に hook の入力（JSON）を受け取る
// - pre: 判断（allow / ask / deny）を hook の出力（JSON）として標準出力に書く。ask にした呼び出しを tool_use_id ごとに記録する
// - post: 開く前に ask にした呼び出しだけ、そのサイトを一覧に足す（標準出力には何も書かない。足せないときは標準エラーに書いて 1 で終える）
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
  // 文字列でないもの（文字列にすると URL に見える配列など）は読まない
  if (typeof raw !== 'string') return { reason: '読み取れない URL' }
  let url
  try {
    url = new URL(raw)
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

/** ロックを待つ長さ・古いロック（消し忘れ）とみなす長さ（hook の timeout の 10 秒に収める） */
const LOCK_WAIT_MS = 5000
const LOCK_STALE_MS = 30 * 1000

/** 少し待つ（hook は短い間しか動かないため、止めて待つ） */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** フォルダが古い（消し忘れ）か。なければ false */
function isStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS
  } catch {
    return false
  }
}

/** ロックのフォルダを、中の持ち主の印ごと消す（すでにないときは何もしない） */
function removeLock(lockPath) {
  try {
    unlinkSync(join(lockPath, 'owner'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    rmdirSync(lockPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/**
 * 古いロックを片付ける。片付けのロック（.reclaim）を取ってから、もう一度古いかを確かめて消す
 * （2 つのセッションが同じ古いロックを見つけたときに、先に片付けて取り直したロックを、もう片方が消さないように）
 * 片付けのロックを取れないときは何もしない（呼んだ側が少し待ってからもう一度）。片付けのロックも古いときは、片付けの途中で落ちたものとして消す
 */
function reclaimStaleLock(lockPath) {
  const reclaimPath = `${lockPath}.reclaim`
  try {
    mkdirSync(reclaimPath, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (isStale(reclaimPath)) {
      try {
        rmdirSync(reclaimPath)
      } catch {
        // ほかのセッションが先に消したときは、次にもう一度
      }
    }
    return
  }
  try {
    if (isStale(lockPath)) removeLock(lockPath)
  } finally {
    rmdirSync(reclaimPath)
  }
}

/**
 * 一覧のロック（フォルダを作れたら取れた）を取ってから fn を動かす。ほかのセッションが一覧に足している間は待つ
 * ロックには持ち主の印（owner）を書き、外すときは自分の印のときだけ外す。古いロックは消し忘れとみなして片付ける。待ちきれないときは、理由を投げる
 */
function withListLock(fn) {
  const lockPath = `${listPath}.lock`
  const ownerPath = join(lockPath, 'owner')
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    // 待つのは決めた時間まで（古いロックを消せないときも、ここで止まる）
    if (Date.now() > deadline) throw new Error(`ほかのセッションが一覧を使っていて、ロック（${lockPath}）を取れませんでした`)
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      try {
        writeFileSync(ownerPath, token, { mode: 0o600 })
      } catch (error) {
        removeLock(lockPath)
        throw error
      }
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    try {
      if (isStale(lockPath)) {
        reclaimStaleLock(lockPath)
        if (!existsSync(lockPath)) continue
      }
    } catch {
      // 消せないときは、少し待ってからもう一度
    }
    sleep(100)
  }
  // 自分の印のときだけ外す（一覧を書いている間に、ほかのセッションに古いロックとして片付けられ、取り直されたときは消さない）
  const release = () => {
    let owner = null
    try {
      owner = readFileSync(ownerPath, 'utf-8')
    } catch {
      // 印が読めないときは、自分のロックとはみなさない
    }
    if (owner !== token) return false
    removeLock(lockPath)
    return true
  }
  let result
  try {
    result = fn()
  } catch (error) {
    release()
    throw error
  }
  if (!release()) {
    throw new Error(`一覧に足している間に、ロック（${lockPath}）がほかのセッションに替わりました。一覧を確かめてください`)
  }
  return result
}

/**
 * 一覧の最後に足す。最後の行に改行がないときは、先に改行を足す（行がつながらないように）
 * 一覧全体を一時ファイルに書いてから入れ替える（書き込みが途中で失敗しても、切れたオリジンを一覧に残さない）
 */
function appendOrigin(origin) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  let text = ''
  try {
    text = readFileSync(listPath, 'utf-8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const prefix = text.length > 0 && !text.endsWith('\n') ? '\n' : ''
  const temp = `${listPath}.tmp-${process.pid}`
  try {
    writeFileSync(temp, `${text}${prefix}${origin}\n`, { mode: 0o600 })
    renameSync(temp, listPath)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // 一時ファイルができていなければ、消すものはない
    }
    throw error
  }
}

const decision = (permissionDecision, permissionDecisionReason) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } })

const input = JSON.parse(readFileSync(0, 'utf-8'))
const allowed = () => new Set([...DEFAULT_ORIGINS, ...readList()])

// 新しいタブを開く操作（browser_tabs）は、URL を渡したときだけ確かめる。URL のない操作（一覧・閉じる・選ぶ）は、hook では決めない
const noUrlTabs = input.tool_name === 'mcp__playwright__browser_tabs' && input.tool_input?.url == null

if (noUrlTabs) {
  // 決めないことを playwright-navigate-gate.sh に伝える（.sh は何も出さずに終え、ふだんの確認に任せる）
  if (mode === 'pre') process.stdout.write('NO_DECISION')
} else if (mode === 'pre') {
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
    } catch (error) {
      // 記録がない（確かめなかった呼び出し）ときは、何もしない。読めない・消せないときは、足さずに伝える
      if (error.code !== 'ENOENT') {
        process.stderr.write(
          `確かめた呼び出しの記録を消せませんでした（${file}: ${error.message}）。一覧には足していません。次も確認が出ます。記録のフォルダの権限を確かめてください\n`,
        )
        process.exit(1)
      }
      origin = null
    }
  }
  // 開く前に ask にした呼び出しだけ足す（記録したオリジンを、もう一度読み直してから足す）
  // 開いた URL のオリジンが記録と違う（ほかの hook が入力を書き換えたなど）ときは、どちらも足さない
  const checked = origin ? originOf(origin).origin : null
  const opened = originOf(input.tool_input?.url).origin
  if (checked && checked === opened) {
    try {
      // 一覧にあるかを確かめてから足すまでを、ロックの中で行う（同じサイトを二重に足さない）
      withListLock(() => {
        if (!allowed().has(checked)) appendOrigin(checked)
      })
    } catch (error) {
      process.stderr.write(
        `許可したサイトの一覧に足せませんでした（${listPath}: ${error.message}）。ページは開いています。次も確認が出ます。一覧のファイルを直すか、${checked} の行を自分で足してください\n`,
      )
      process.exit(1)
    }
  }
}
