#!/usr/bin/env node
// Bash のコマンド（標準入力）を部分に分け、CodeRabbit のレビューを動かす部分ごとに
// {"check": "cli" | "github", "dir": <その部分を実行するフォルダ>} を1行ずつ出す（cr-limit-gate.sh から使う）
//
// - cli: 手元の ~/.claude/hooks/cr-review.sh（--accept・--base はレビューを動かさないので出さない）
// - github: gh pr create・gh pr ready（--undo は除く）・@coderabbitai を書く gh pr comment・git push
//   （ブランチの削除・タグだけの push は除く）
// - 部分の先頭の代入に SKIP_CR_LIMIT=1 がある部分は出さない
// - フォルダは、git -C <dir> → それより前の cd <dir> → 引数の cwd の順に決める（相対パスは、その時点のフォルダから見る）
//
// 使い方: node cr-limit-targets.mjs <cwd> < コマンド
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ASSIGNMENT, LEADING_KEYWORDS, segments } from './lib/shell-words.mjs'

const src = readFileSync(0, 'utf-8')
const home = process.env.HOME || os.homedir()
let dir = process.argv[2] || process.cwd()

/** ~・$HOME を展開し、base から見たフォルダにする */
function resolveDir(base, p) {
  const expanded = p.replace(/^~(?=\/|$)/, home).replace(/^\$HOME(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home)
  return path.resolve(base, expanded)
}

const CR_REVIEW = /^(~|\$HOME|\$\{HOME\}|\/[^\s]*)\/\.claude\/hooks\/cr-review\.sh$/

/** gh pr comment が @coderabbitai を書くか（引数・heredoc の本文・-F / --body-file のファイル） */
function mentionsCodeRabbit(args) {
  // heredoc の本文は言葉に入らないため、コマンド全体からも探す
  if (src.includes('@coderabbitai')) return true
  for (let i = 0; i < args.length; i++) {
    let file = null
    if (args[i] === '-F' || args[i] === '--body-file') file = args[i + 1]
    else if (args[i].startsWith('--body-file=')) file = args[i].slice('--body-file='.length)
    if (!file || file === '-') continue
    const full = resolveDir(dir, file)
    try {
      if (existsSync(full) && readFileSync(full, 'utf-8').includes('@coderabbitai')) return true
    } catch {
      // 読めないファイルは見ない
    }
  }
  return false
}

/** git push の引数が、ふつうのブランチを送るか（削除・タグだけなら false） */
function pushesBranch(args) {
  let remote = null
  const refspecs = []
  let tags = false
  for (const a of args) {
    if (a === '--delete' || a === '-d') return false
    if (a === '--tags') tags = true
    else if (a.startsWith('-')) continue
    else if (remote === null) remote = a
    else refspecs.push(a)
  }
  if (refspecs.length > 0) return refspecs.some((r) => !r.startsWith(':'))
  return !tags
}

const out = []
for (const words of segments(src)) {
  let i = 0
  let skip = false
  while (i < words.length && (LEADING_KEYWORDS.has(words[i]) || ASSIGNMENT.test(words[i]))) {
    if (words[i] === 'SKIP_CR_LIMIT=1') skip = true
    i++
  }
  const argv = words.slice(i)
  if (argv[0] === 'cd') {
    if (argv[1] !== undefined) dir = resolveDir(dir, argv[1])
    continue
  }
  if (skip || argv.length === 0) continue

  // bash <script> / sh <script> も、そのスクリプトの実行として見る
  const run = (argv[0] === 'bash' || argv[0] === 'sh') && argv[1] !== undefined ? argv.slice(1) : argv
  if (CR_REVIEW.test(run[0])) {
    if (!run.slice(1).some((a) => a === '--accept' || a === '--base')) out.push({ check: 'cli', dir })
    continue
  }

  if (argv[0] === 'gh' && argv[1] === 'pr') {
    const args = argv.slice(3)
    if (argv[2] === 'create') out.push({ check: 'github', dir })
    else if (argv[2] === 'ready' && !args.includes('--undo')) out.push({ check: 'github', dir })
    else if (argv[2] === 'comment' && mentionsCodeRabbit(args)) out.push({ check: 'github', dir })
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

for (const o of out) console.log(JSON.stringify(o))
