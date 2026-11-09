// Bash のコマンドを、部分（;・&&・||・|・&・改行・括弧で区切った単純なコマンド）ごとの言葉の並びに分ける
// （.claude/hooks の hook から使う）
//
// - 引用符・$( )・バッククォート・heredoc・here-string・コメントの中は区切らない
// - 引用符は外し、$( )・バッククォートは、そのままの文字で1つの言葉にする
// - heredoc の本文は、コマンドとして読まない。本文は、その heredoc を書いた部分の heredoc（文字列）に入れる
// - サブシェルの括弧は、['('] と [')'] の部分として出す（中の cd が外に効かないことを、使う側で扱えるように）

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
  for (const { delim, stripTabs, owner } of pending) {
    const body = []
    while (j < s.length) {
      const nl = s.indexOf('\n', j)
      const lineEnd = nl < 0 ? s.length : nl
      let line = s.slice(j, lineEnd)
      if (stripTabs) line = line.replace(/^\t+/, '')
      j = lineEnd + 1
      if (line === delim) break
      body.push(line)
    }
    if (owner) owner.heredoc = (owner.heredoc ?? '') + body.join('\n') + '\n'
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
export function segments(s) {
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
      // 本文は、この部分の言葉の並び（words）に付ける
      pending.push({ ...h, owner: words })
      i = h.end
    } else if (c === '\n') {
      endSegment()
      i = pending.length > 0 ? skipHeredocBodies(s, i, pending) : i + 1
    } else if (c === '&' && (s[i + 1] === '>' || (inWord && /[<>]$/.test(word)))) {
      // リダイレクト（&>・2>&1・<&3）の & は区切りではない
      word += c
      inWord = true
      i++
    } else if (c === ';' || c === '&' || c === '|') {
      endSegment()
      i += s[i + 1] === c ? 2 : 1
    } else if (c === '(' || c === ')') {
      // サブシェル（( … )）の括弧も区切りにし、括弧だけの部分を出す
      endSegment()
      segs.push([c])
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

export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// 部分の先頭に来て、その後ろのコマンドを実行する言葉（{ git push; }・then git push・! git push など）
export const LEADING_KEYWORDS = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time'])

