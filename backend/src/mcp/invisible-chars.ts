/**
 * 画面には見えないが、AI には読める文字
 * - Unicode Tag Block（U+E0000〜U+E007F）: 指示や持ち出すデータを、見えないまま埋め込める
 * - 幅のない文字（U+00AD・U+200B〜U+200F・U+2060〜U+2064・U+FEFF）: 語を分けて検出をすり抜けたり、指示を隠したりできる
 * - 文字の向きを変える制御文字（U+202A〜U+202E・U+2066〜U+2069）: 見た目と中身の順番を変えられる
 */
const INVISIBLE_CHARS =
  /[\u{E0000}-\u{E007F}\u00AD\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

/**
 * 見えない文字を取り除く
 * MCP サーバーが返す文字列（会話の本文・話者名・キーワード）は、利用者が画面で確かめられない内容を
 * AI に渡さないよう、見えない文字を取り除いてから返す
 */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_CHARS, '');
}
