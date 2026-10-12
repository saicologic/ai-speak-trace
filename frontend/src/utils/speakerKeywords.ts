import { extractKeywords } from './keywords';
import type { GinzaKeywords, Keyword, KeywordSource, Utterance } from '../types';

/**
 * 画面に出すキーワード（会話全体、または選んだ話者の発話だけ）
 * - 標準: 正規表現で取り出す（話者を選ばない場合は fullText から、選んだ場合はその話者の発話だけから）
 * - GiNZA: バックエンドで取り出した結果を使う（取り出し中は空）
 */
export function keywordsFor(
  utterances: Utterance[],
  source: KeywordSource,
  ginza: GinzaKeywords | null,
  speakerId: string | null,
  /** 会話全体のテキスト（話者を選ばない場合に使う。これまでの標準の一覧と同じにするため） */
  fullText?: string,
): Keyword[] {
  if (source === 'ginza') {
    if (!ginza) return [];
    return speakerId ? (ginza.bySpeaker[speakerId] ?? []) : ginza.keywords;
  }
  if (!speakerId && fullText !== undefined) return extractKeywords(fullText);
  const texts = speakerId
    ? utterances.filter((u) => u.speakerId === speakerId).map((u) => u.text)
    : utterances.map((u) => u.text);
  return extractKeywords(texts.join('\n'));
}
