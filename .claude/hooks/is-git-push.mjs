#!/usr/bin/env node
// Bash のコマンド（標準入力）を部分に分け、部分の先頭で git push を実行するかを調べる
// 終了コード 0: push する部分がある / 1: ない
//
// - 部分の区切り: ;・&&・||・|・&・改行（引用符・$( )・バッククォート・heredoc・コメントの中は区切らない）
// - 部分の先頭の環境変数の代入（FOO=1・FOO="a b"）と、git の -C <path>・-c <k=v> などのオプションは飛ばす
// - 部分の先頭の代入に SKIP_TDD_CHECK=1 があれば、その部分は調べない
// - $( ) の中のコマンドは調べない（コミットメッセージを作る cat <<'EOF' などのため）
import { readFileSync } from 'node:fs'

const src = readFileSync(0, 'utf-8')

/** ' から次の ' まで（i は開きの ' の位置）。閉じの ' の次の位置を返す */
function skipSingle(s, i) {
  const j = s.indexOf("'", i + 1)
  return j < 0 ? s.length : j + 1
}

/** " から次の " まで。\ と $( ) とバッククォートを飛ばす */
function skipDouble(s, i) {
  let j = i + 1
  while (j < s.length) {
    if (s[j] === '\\') j += 2
    else if (s[j] === '$' && s[j + 1] === '(') j = skipSubst(s, j + 2)
    else if (s[j] === '`') j = skipBacktick(s, j)
    else if (s[j] === '"') return j + 1
    else j++
  }
  return s.length
}

function skipBacktick(s, i) {
  let j = i + 1
  while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1
  return j + 1
}

/** heredoc の開始（<< の位置）から区切りの言葉を読む。{ end, delim, stripTabs } を返す */
function readHeredocStart(s, i) {
  let j = i + 2
  let stripTabs = false
  if (s[j] === '-') {
    stripTabs = true
    j++
  }
  while (s[j] === ' ' || s[j] === '\t') j++
  let delim = ''
  while (j < s.length && !/[\s;&|<>()]/.test(s[j])) {
    if (s[j] === "'" || s[j] === '"') {
      const q = s[j]
      const k = s.indexOf(q, j + 1)
      const e = k < 0 ? s.length : k
      delim += s.slice(j + 1, e)
      j = e + 1
    } else if (s[j] === '\\') {
      delim += s[j + 1] ?? ''
      j += 2
    } else {
      delim += s[j++]
    }
  }
  return { end: j, delim, stripTabs }
}

/** 改行（i は改行の位置）の後の heredoc の本文を、区切りの行まで飛ばす */
function skipHeredocBodies(s, i, pending) {
  let j = i + 1
  for (const { delim, stripTabs } of pending) {
    while (j < s.length) {
      const nl = s.indexOf('\n', j)
      const lineEnd = nl < 0 ? s.length : nl
      let line = s.slice(j, lineEnd)
      if (stripTabs) line = line.replace(/^\t+/, '')
      j = lineEnd + 1
      if (line === delim) break
    }
  }
  pending.length = 0
  return j
}

/** $( の後（i は ( の次）から、対応する ) の次の位置を返す */
function skipSubst(s, i) {
  let depth = 0
  const pending = []
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') j += 2
    else if (c === "'") j = skipSingle(s, j)
    else if (c === '"') j = skipDouble(s, j)
    else if (c === '`') j = skipBacktick(s, j)
    else if (c === '$' && s[j + 1] === '(') j = skipSubst(s, j + 2)
    // here-string（<<<）は heredoc ではない
    else if (c === '<' && s[j + 1] === '<' && s[j + 2] === '<') j += 3
    else if (c === '<' && s[j + 1] === '<') {
      const h = readHeredocStart(s, j)
      pending.push(h)
      j = h.end
    } else if (c === '\n' && pending.length > 0) j = skipHeredocBodies(s, j, pending)
    else if (c === '(') {
      depth++
      j++
    } else if (c === ')') {
      if (depth === 0) return j + 1
      depth--
      j++
    } else j++
  }
  return s.length
}

/** コマンドを、部分ごとの言葉の並びに分ける */
function segments(s) {
  const segs = []
  let words = []
  let word = ''
  let inWord = false
  const pending = []
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segs.push(words)
    words = []
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      // 行の続き（\ と改行）は飛ばす
      if (s[i + 1] !== '\n') {
        word += s[i + 1] ?? ''
        inWord = true
      }
      i += 2
    } else if (c === "'") {
      const e = skipSingle(s, i)
      word += s.slice(i + 1, e - 1)
      inWord = true
      i = e
    } else if (c === '"') {
      const e = skipDouble(s, i)
      word += s.slice(i + 1, e - 1)
      inWord = true
      i = e
    } else if (c === '`') {
      const e = skipBacktick(s, i)
      word += s.slice(i, e)
      inWord = true
      i = e
    } else if (c === '$' && s[i + 1] === '(') {
      const e = skipSubst(s, i + 2)
      word += s.slice(i, e)
      inWord = true
      i = e
    } else if (c === '#' && !inWord) {
      // コメントは行の終わりまで飛ばす
      const nl = s.indexOf('\n', i)
      i = nl < 0 ? s.length : nl
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      // here-string（<<<）は heredoc ではない。後ろの言葉はふつうに読む
      endWord()
      i += 3
    } else if (c === '<' && s[i + 1] === '<') {
      endWord()
      const h = readHeredocStart(s, i)
      pending.push(h)
      i = h.end
    } else if (c === '\n') {
      endSegment()
      i = pending.length > 0 ? skipHeredocBodies(s, i, pending) : i + 1
    } else if (c === ';' || c === '&' || c === '|') {
      endSegment()
      i += s[i + 1] === c ? 2 : 1
    } else if (c === '(' || c === ')') {
      // サブシェル（( … )）の括弧も区切りにする
      endSegment()
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else {
      word += c
      inWord = true
      i++
    }
  }
  endSegment()
  return segs
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// 部分の先頭に来て、その後ろのコマンドを実行する言葉（{ git push; }・then git push・! git push など）
const LEADING_KEYWORDS = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time'])

function isPush(words) {
  let i = 0
  let skip = false
  while (i < words.length && (LEADING_KEYWORDS.has(words[i]) || ASSIGNMENT.test(words[i]))) {
    if (words[i] === 'SKIP_TDD_CHECK=1') skip = true
    i++
  }
  if (skip || words[i] !== 'git') return false
  i++
  while (i < words.length && words[i].startsWith('-')) {
    // -C <path>・-c <k=v> は値を1つ取る
    i += words[i] === '-C' || words[i] === '-c' ? 2 : 1
  }
  return words[i] === 'push'
}

process.exit(segments(src).some(isPush) ? 0 : 1)
