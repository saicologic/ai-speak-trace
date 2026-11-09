#!/usr/bin/env node
// Bash のコマンド（標準入力）を部分に分け、部分の先頭で git push を実行するかを調べる
// 終了コード 0: push する部分がある / 1: ない
//
// - 部分の区切り: ;・&&・||・|・&・改行（引用符・$( )・バッククォート・heredoc・コメントの中は区切らない）
// - 部分の先頭の環境変数の代入（FOO=1・FOO="a b"）と、git の -C <path>・-c <k=v> などのオプションは飛ばす
// - 部分の先頭の代入に SKIP_TDD_CHECK=1 があれば、その部分は調べない
// - $( ) の中のコマンドは調べない（コミットメッセージを作る cat <<'EOF' などのため）
import { readFileSync } from 'node:fs'
import { ASSIGNMENT, LEADING_KEYWORDS, segments } from './lib/shell-words.mjs'

const src = readFileSync(0, 'utf-8')

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
