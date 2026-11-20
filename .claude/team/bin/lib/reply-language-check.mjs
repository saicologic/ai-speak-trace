#!/usr/bin/env node
// reply-language-check.sh から呼ぶ。標準入力に Stop の hook の入力（JSON）を受け取り、
// 返答の最後のメッセージ（last_assistant_message）が英語なら、止める出力（JSON）を標準出力に書く
import { readFileSync } from 'node:fs'

/** 判断に使う文字がこれより少ない返答は、確かめない（短い返答は判断できないため） */
const MIN_LETTERS = 40
/** 日本語の文字の割合がこれより小さければ、英語の返答とみなす */
const MIN_JAPANESE_RATIO = 0.2

/** ファイルの名前とみなす拡張子（/ のない名前は、この拡張子のときだけ除く） */
const FILE_EXTENSIONS = 'sh|mjs|cjs|js|jsx|ts|tsx|json|md|css|html|yml|yaml|toml|rs|py|txt|lock|log|png|svg|jpg|mp3|m4a|wav|dmg'

/**
 * 字下げしたコードブロック（空の行の後に、4 つ以上の空白かタブで字下げした行。CommonMark と同じ）を除く
 * 箇条書きの続き（前の段落が箇条書き・字下げした行）と、空の行のない字下げ（段落の続き）は、日本語を除かないよう、コードブロックとみなさない
 */
function removeIndentedCode(text) {
  const lines = text.split('\n')
  const blank = (line) => /^[ \t]*$/.test(line)
  const indented = (line) => /^(?: {4,}|[ ]{0,3}\t)/.test(line) && !blank(line)
  const listOrIndented = (line) => /^[ \t]/.test(line) || /^(?:[-*+]|\d+[.)])[ \t]/.test(line)
  const out = []
  let lastText = null
  for (let i = 0; i < lines.length; i++) {
    const startsCode = indented(lines[i]) && (i === 0 || blank(lines[i - 1])) && (lastText === null || !listOrIndented(lastText))
    if (!startsCode) {
      out.push(lines[i])
      if (!blank(lines[i])) lastText = lines[i]
      continue
    }
    // 字下げした行と、その間の空の行（後に字下げした行が続くもの）を、コードブロックとして除く
    let end = i
    for (let j = i; j < lines.length; j++) {
      if (indented(lines[j])) end = j
      else if (!blank(lines[j])) break
    }
    out.push(' ')
    i = end
  }
  return out.join('\n')
}

/** 言語の判断に関係しない部分（コード・引用・URL・メールアドレス・パス・ファイルの名前）を除く */
function prose(text) {
  return (
    // 字下げしたコードブロックは、囲みのコードブロックを除いた後に除く（囲みの中の字下げを、先に読み違えないように）
    removeIndentedCode(
      // コードブロック（``` と ~~~。字下げした開き・箇条書きの中の開きも。開きと同じ記号だけで、同じ数以上の閉じまで。閉じがなければ最後まで）
      // ``` の開きの行の後ろにバッククォートがあれば、インラインコードなので開きとみなさない（CommonMark と同じ）
      text.replace(/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?((`|~)\2{2,})(?:(?<=~)[^\n]*|[^`\n]*)\n[\s\S]*?(?:^[ \t]*\1\2*[ \t]*$|(?![\s\S]))/gm, ' '),
    )
      // 引用の行（英語の指摘・ログをそのまま引くことがあるため）。インラインコードより先に除き、引用をまたいで消さない
      .replace(/^[ \t]*>.*$/gm, ' ')
      // インラインコード（開きと同じ数のバッククォートで閉じるまで。空の行はまたがない）
      .replace(/(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, ' ')
      // URL・メールアドレス（ASCII の文字まで。すぐ後に続く日本語は消さない）
      .replace(/https?:\/\/[\x21-\x7e]+/g, ' ')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
      // パス・ブランチの名前（/ を含む ASCII の並び。+ も含む。日本語・かっこのすぐ後に書いたものも）と、/ のないファイルの名前
      .replace(/(?<![\w.~+-])[\w.~+-]*\/[\w./~+-]*/g, ' ')
      .replace(new RegExp(`(?<![\\w.~-])[\\w~-]+(?:\\.[\\w-]+)*\\.(?:${FILE_EXTENSIONS})(?![\\w.~-])`, 'g'), ' ')
  )
}

const input = JSON.parse(readFileSync(0, 'utf-8'))
const message = input.last_assistant_message
if (input.stop_hook_active !== true && typeof message === 'string') {
  const text = prose(message)
  const japanese = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (japanese + latin >= MIN_LETTERS && japanese / (japanese + latin) < MIN_JAPANESE_RATIO) {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          '返答の最後のメッセージが英語になっています。返答は日本語で書く決まりです。同じ内容を、日本語で書き直してください（コード・コマンド・ファイルの場所・識別子はそのままでかまいません）。',
      }),
    )
  }
}
