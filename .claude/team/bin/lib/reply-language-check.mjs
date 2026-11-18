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
 * / を含む並びが、パスかどうか（build/test のような、/ でつないだふつうの言葉は除かない）
 * /・~・. で始まる、/ が 2 つ以上ある、拡張子で終わる、のどれかならパスとみなす
 */
function isPath(token) {
  return /^[/~.]/.test(token) || (token.match(/\//g) ?? []).length >= 2 || /\.[A-Za-z0-9]{1,5}$/.test(token)
}

/** 言語の判断に関係しない部分（コード・引用・URL・メールアドレス・パス・ファイルの名前）を除く */
function prose(text) {
  return (
    text
      // コードブロック（``` と ~~~。行の頭から 3 つまでの空白の後に置き、開きと同じ記号だけで、同じ数以上の閉じまで）
      .replace(/^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?^ {0,3}\1\2*[ \t]*$/gm, ' ')
      // 引用の行（英語の指摘・ログをそのまま引くことがあるため）。インラインコードより先に除き、引用をまたいで消さない
      .replace(/^[ \t]*>.*$/gm, ' ')
      // インラインコード（開きと同じ数のバッククォートで閉じるまで。空の行はまたがない）
      .replace(/(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, ' ')
      // URL・メールアドレス（ASCII の文字まで。すぐ後に続く日本語は消さない）
      .replace(/https?:\/\/[\x21-\x7e]+/g, ' ')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
      // パス（日本語・かっこのすぐ後に書いたものも）と、/ のないファイルの名前
      .replace(/(?<![\w.~-])[\w.~-]*\/[\w./~-]*/g, (token) => (isPath(token) ? ' ' : token))
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
