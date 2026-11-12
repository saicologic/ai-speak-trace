/**
 * 画面には見えないが、AI には読める文字（Unicode の Default_Ignorable_Code_Point）
 * 表示しなくてよい文字として Unicode が定めているもの。たとえば次を含む
 * - Unicode Tag Block（U+E0000〜U+E0FFF）: 指示や持ち出すデータを、見えないまま埋め込める
 * - 幅のない文字（U+00AD・U+034F・U+200B〜U+200F・U+2060〜U+2064・U+FEFF など）: 語を分けて検出をすり抜けたり、指示を隠したりできる
 * - 文字の向きを変える制御文字（U+061C・U+202A〜U+202E・U+2066〜U+2069）: 見た目と中身の順番を変えられる
 * 文字を1つずつ挙げると漏れが出るため、Unicode の性質でまとめて指定する
 */
const INVISIBLE_CHARS = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * 見えない文字を取り除く
 * MCP サーバーが返す文字列（会話の本文・話者名・キーワード）は、利用者が画面で確かめられない内容を
 * AI に渡さないよう、見えない文字を取り除いてから返す
 */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_CHARS, '');
}
