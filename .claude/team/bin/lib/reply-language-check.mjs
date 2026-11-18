#!/usr/bin/env node
// reply-language-check.sh から呼ぶ。標準入力に Stop の hook の入力（JSON）を受け取り、
// 返答の最後のメッセージ（last_assistant_message）が英語なら、止める出力（JSON）を標準出力に書く
import { readFileSync } from 'node:fs'

/** 判断に使う文字がこれより少ない返答は、確かめない（短い返答は判断できないため） */
const MIN_LETTERS = 40
/** 日本語の文字の割合がこれより小さければ、英語の返答とみなす */
const MIN_JAPANESE_RATIO = 0.2

/** 言語の判断に関係しない部分（コード・URL・パス・メールアドレス）を除く */
function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/(?:^|\s)[\w.~-]*\/[\w./~-]*/g, ' ')
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
