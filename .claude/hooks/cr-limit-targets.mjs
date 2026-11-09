#!/usr/bin/env node
// Bash のコマンド（標準入力）を部分に分け、CodeRabbit のレビューを動かす部分ごとに
// {"check": "cli" | "github", "dir": <その部分を実行するフォルダ>} を1行ずつ出す（cr-limit-gate.sh から使う）
//
// - cli: 手元の ~/.claude/hooks/cr-review.sh（--accept・--base はレビューを動かさないので出さない）
// - github: gh pr create・gh pr ready（--undo は除く）・@coderabbitai を書く gh pr comment・git push
//   （ブランチの削除・タグだけの push は除く）
// - 部分の先頭の代入に SKIP_CR_LIMIT=1 がある部分は出さない
// - フォルダは、git -C <dir> → それより前の cd <dir> → 引数の cwd の順に決める
//   - 相対パスは、その時点のフォルダから見る。サブシェル（( … )）の中の cd は、外に効かない
//   - $( )・$VAR などを含み、決められないパスは、引数の cwd とする（止めるべきものを見落とさないように）
//
// 使い方: node cr-limit-targets.mjs <cwd> < コマンド
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ASSIGNMENT, LEADING_KEYWORDS, segments } from './lib/shell-words.mjs'

const src = readFileSync(0, 'utf-8')
const home = process.env.HOME || os.homedir()
const startDir = process.argv[2] || process.cwd()
let dir = startDir
const dirStack = []

/** ~・$HOME を展開し、base から見たフォルダにする。決められないときは、引数の cwd */
function resolveDir(base, p) {
  const expanded = p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
  if (/[$`]/.test(expanded)) return startDir
  return path.resolve(base, expanded)
}

const CR_REVIEW = /\/\.claude\/hooks\/cr-review\.sh$/

/** gh pr comment が @coderabbitai を書くか（引数・その部分の heredoc の本文・-F / --body-file のファイル・標準入力） */
function mentionsCodeRabbit(args, heredoc) {
  if ((heredoc ?? '').includes('@coderabbitai')) return true
  if (args.some((a) => a.includes('@coderabbitai'))) return true
  for (let i = 0; i < args.length; i++) {
    let file = null
    if (args[i] === '-F' || args[i] === '--body-file') file = args[i + 1]
    else if (args[i].startsWith('--body-file=')) file = args[i].slice('--body-file='.length)
    if (!file) continue
    if (file === '-') {
      // 本文を標準入力から読むときは、パイプの前の部分を区別できないため、コマンド全体と < のファイルで見る
      if (src.includes('@coderabbitai')) return true
      const k = args.findIndex((a) => a === '<' || (a.startsWith('<') && a.length > 1))
      if (k < 0) continue
      file = args[k] === '<' ? args[k + 1] : args[k].slice(1)
      if (!file) continue
    }
    const full = resolveDir(dir, file)
    try {
      if (existsSync(full) && readFileSync(full, 'utf-8').includes('@coderabbitai')) return true
    } catch {
      // 読めないファイルは見ない
    }
  }
  return false
}

// git push の、値を1つ取るオプション
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
// リダイレクトだけの言葉（> file のように、後ろの言葉が行き先）
const REDIRECT_ONLY = /^(\d*|&)(>>?|<)$/
// リダイレクトの言葉（>/dev/null・2>&1 など）
const REDIRECT = /^(\d*|&)(>>?|<)/

/** git push の引数が、ふつうのブランチを送るか（削除・タグだけなら false） */
function pushesBranch(args) {
  let remote = null
  const refspecs = []
  let tags = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (REDIRECT_ONLY.test(a) || PUSH_VALUE_OPTIONS.has(a)) {
      i++
      continue
    }
    if (REDIRECT.test(a)) continue
    if (a === '--delete' || a === '-d') return false
    if (a === '--tags') tags = true
    else if (a.startsWith('-')) continue
    else if (remote === null) remote = a
    else refspecs.push(a)
  }
  if (refspecs.length > 0) return refspecs.some((r) => !r.startsWith(':'))
  return !tags
}

// bash・sh の、値を1つ取るオプション
const SHELL_VALUE_OPTIONS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])

const out = []

/** 部分の並びを順に調べ、レビューを動かす部分を out に足す */
function inspect(segs) {
  for (const words of segs) {
    // サブシェルの中の cd は、括弧を閉じたら戻す
    if (words.length === 1 && words[0] === '(') {
      dirStack.push(dir)
      continue
    }
    if (words.length === 1 && words[0] === ')') {
      if (dirStack.length > 0) dir = dirStack.pop()
      continue
    }

    let i = 0
    let skip = false
    while (i < words.length && (LEADING_KEYWORDS.has(words[i]) || ASSIGNMENT.test(words[i]))) {
      if (words[i] === 'SKIP_CR_LIMIT=1') skip = true
      i++
    }
    const argv = words.slice(i)
    if (argv[0] === 'cd') {
      // cd・cd -P・cd -- <dir>（引数がなければ HOME）
      let target
      for (let k = 1; k < argv.length; k++) {
        if (argv[k] === '--') {
          target = argv[k + 1]
          break
        }
        if (argv[k].startsWith('-') && argv[k] !== '-') continue
        target = argv[k]
        break
      }
      dir = target === undefined ? home : resolveDir(dir, target)
      continue
    }
    if (skip || argv.length === 0) continue

    // bash <script> / sh -x <script> も、そのスクリプトの実行として見る。
    // bash -c '<コマンド>' は、引数のコマンドを同じように調べる（中の cd は、外に効かない）
    let run = argv
    if (argv[0] === 'bash' || argv[0] === 'sh') {
      let k = 1
      let inner
      while (k < argv.length) {
        const a = argv[k]
        if (SHELL_VALUE_OPTIONS.has(a)) k += 2
        else if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) {
          inner = argv[k + 1] ?? ''
          break
        } else if (a.startsWith('-') || a.startsWith('+')) k++
        else break
      }
      if (inner !== undefined) {
        const saved = dir
        inspect(segments(inner))
        dir = saved
        continue
      }
      run = argv.slice(k)
    }
    if (run.length > 0 && run[0].includes('/') && CR_REVIEW.test(resolveDir(dir, run[0]))) {
      if (!run.slice(1).some((a) => a === '--accept' || a === '--base')) out.push({ check: 'cli', dir })
      continue
    }

    if (argv[0] === 'gh' && argv[1] === 'pr') {
      const args = argv.slice(3)
      if (argv[2] === 'create') out.push({ check: 'github', dir })
      else if (argv[2] === 'ready' && !args.includes('--undo')) out.push({ check: 'github', dir })
      else if (argv[2] === 'comment' && mentionsCodeRabbit(args, words.heredoc)) out.push({ check: 'github', dir })
      continue
    }

    if (argv[0] === 'git') {
      let j = 1
      let gitDir = dir
      while (j < argv.length && argv[j].startsWith('-')) {
        // -C <path>・-c <k=v> は値を1つ取る
        if (argv[j] === '-C' && argv[j + 1] !== undefined) gitDir = resolveDir(gitDir, argv[j + 1])
        j += argv[j] === '-C' || argv[j] === '-c' ? 2 : 1
      }
      if (argv[j] === 'push' && pushesBranch(argv.slice(j + 1))) out.push({ check: 'github', dir: gitDir })
    }
  }
}

inspect(segments(src))

for (const o of out) console.log(JSON.stringify(o))
