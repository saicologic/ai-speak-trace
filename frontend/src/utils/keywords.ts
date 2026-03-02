import type { Keyword } from '../types';

/**
 * 文字起こしテキストから専門用語（キーワード）を抽出する
 * カタカナ語・英字略語・複合語を正規表現で検出し、出現回数でソートする
 */
export function extractKeywords(fullText: string): Keyword[] {
  const allMatches: { text: string; start: number; end: number }[] = [];

  /** 専門用語検出パターン（優先度順: 複合語 → 単独語） */
  const patterns: RegExp[] = [
    // 英字＋カタカナの複合語 (AIエコシステム等)
    /[A-Za-z][A-Za-z0-9]*[ァ-ヴー・]{2,}/g,
    // カタカナ＋漢字の複合語 (コーネル大学等)
    /[ァ-ヴー・]{2,}[一-龯々]+/g,
    // 漢字＋英字の複合語 (富岳LLM等) - 漢字2文字以上
    /[一-龯々]{2,}[A-Z][A-Za-z0-9]*/g,
    // 英語の複数語 (Kotoba Technologies等)
    /[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g,
    // カタカナ単独語 (3文字以上)
    /[ァ-ヴー・]{3,}/g,
    // 英字略語 (2文字以上の大文字)
    /[A-Z]{2,}[0-9]*/g,
    // 英単語 (先頭大文字、4文字以上)
    /[A-Z][a-z]{3,}[A-Za-z0-9]*/g,
  ];

  for (const pattern of patterns) {
    for (const match of fullText.matchAll(pattern)) {
      allMatches.push({
        text: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }
  }

  // 重複除去: 同じ位置で短いマッチは除外（長い複合語を優先）
  const filtered = allMatches.filter((m) => {
    return !allMatches.some(
      (other) =>
        other !== m &&
        other.start <= m.start &&
        other.end >= m.end &&
        other.text.length > m.text.length,
    );
  });

  // 出現回数をカウント
  const counts = new Map<string, number>();
  for (const { text } of filtered) {
    counts.set(text, (counts.get(text) || 0) + 1);
  }

  // カタカナのストップワード（一般的すぎる語を除外）
  const stopWords = new Set([
    'スゴイ', 'スゴク', 'ホント', 'ホントウ', 'チョット',
    'コッチ', 'ソッチ', 'アッチ',
  ]);

  // 頻度順にソートして返す
  return Array.from(counts.entries())
    .filter(([text]) => text.length >= 2 && !stopWords.has(text))
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}
