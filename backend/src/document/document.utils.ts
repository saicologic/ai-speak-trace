import { DocumentChunk } from './types/document.types';

/** チャンク分割の設定 */
export const CHUNK_TARGET_SIZE = 500;
export const CHUNK_OVERLAP = 100;
export const CHUNK_MIN_SIZE = 50;

/** テキストをチャンクに分割（段落→文→文字の順で分割、オーバーラップ付き） */
export function chunkText(
  documentId: string,
  fullText: string,
): DocumentChunk[] {
  // 段落で分割
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // 段落を適切なサイズのチャンクに組み立て
  const rawChunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_TARGET_SIZE) {
      // 段落が長すぎる場合は文で分割
      if (currentChunk.length > 0) {
        rawChunks.push(currentChunk);
        currentChunk = '';
      }
      const sentences = splitIntoSentences(paragraph);
      let sentenceChunk = '';
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > CHUNK_TARGET_SIZE) {
          if (sentenceChunk.length >= CHUNK_MIN_SIZE) {
            rawChunks.push(sentenceChunk);
          }
          // オーバーラップ: 前のチャンクの末尾を引き継ぐ
          sentenceChunk =
            sentenceChunk.length > CHUNK_OVERLAP
              ? sentenceChunk.slice(-CHUNK_OVERLAP) + sentence
              : sentence;
        } else {
          sentenceChunk += sentence;
        }
      }
      if (sentenceChunk.length >= CHUNK_MIN_SIZE) {
        rawChunks.push(sentenceChunk);
      }
    } else if (currentChunk.length + paragraph.length + 1 > CHUNK_TARGET_SIZE) {
      // 現在のチャンクに追加すると超える場合
      if (currentChunk.length >= CHUNK_MIN_SIZE) {
        rawChunks.push(currentChunk);
      }
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + paragraph;
    }
  }

  // 残りを追加
  if (currentChunk.length >= CHUNK_MIN_SIZE) {
    rawChunks.push(currentChunk);
  }

  // DocumentChunk型に変換
  return rawChunks.map((text, index) => ({
    id: `${documentId}_${index}`,
    documentId,
    text,
    chunkIndex: index,
  }));
}

/** テキストを日本語の文に分割 */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** テキストを指定バイト数以内に切り詰め（UTF-8） */
export function truncateToBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  if (encoded.length <= maxBytes) return text;

  // バイト単位で切り詰めてデコード
  const truncated = encoded.slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(truncated).replace(/\uFFFD$/, '');
}
