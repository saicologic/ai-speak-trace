import { createHash } from 'crypto';
import { GENERAL_WORDS } from './general-words';

/** 画面に出すキーワード */
export interface RankedKeyword {
  text: string;
  count: number;
}

/** [笑い] [タイピング] のような、話した言葉ではない音のタグ */
const SOUND_TAG = /\[[^\]]*\]/g;

/** 英字だけの語（ASCII の英数字・空白・記号の一部） */
const ASCII_ONLY = /^[A-Za-z0-9 .'-]+$/;

/** 音のタグを取り除く */
export function stripSoundTags(text: string): string {
  return text.replace(SOUND_TAG, '');
}

/** 語を比べるための形（全角・半角と大文字・小文字をそろえる） */
export function normalizeTerm(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 文字列の一覧のハッシュ（キャッシュが古くないかを確かめるため） */
export function hashTexts(texts: string[]): string {
  return createHash('sha256').update(JSON.stringify(texts)).digest('hex');
}

/**
 * 標準のキーワード抽出（frontend/src/utils/keywords.ts と同じ正規表現）で語を数える
 * GiNZA は英字の語の扱いが弱いため、英字だけの語はこちらの結果を使う
 */
export function countRegexKeywords(text: string): Map<string, number> {
  const allMatches: { text: string; start: number; end: number }[] = [];
  const patterns: RegExp[] = [
    /[A-Za-z][A-Za-z0-9]*[ァ-ヴー・]{2,}/g,
    /[ァ-ヴー・]{2,}[一-龯々]+/g,
    /[一-龯々]{2,}[A-Z][A-Za-z0-9]*/g,
    /[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g,
    /[ァ-ヴー・]{3,}/g,
    /[A-Z]{2,}[0-9]*/g,
    /[A-Z][a-z]{3,}[A-Za-z0-9]*/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      allMatches.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  // 同じ位置で短いマッチは除外（長い複合語を優先）
  const filtered = allMatches.filter(
    (m) =>
      !allMatches.some(
        (other) =>
          other !== m &&
          other.start <= m.start &&
          other.end >= m.end &&
          other.text.length > m.text.length,
      ),
  );
  const counts = new Map<string, number>();
  for (const { text: t } of filtered) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/**
 * GiNZA の語と英字だけの語を合わせ、出てきた回数の多い順に並べる
 * 会話によく出てくる一般的な語（GENERAL_WORDS）は除く
 * - ginzaTerms: 対象の発話ごとの [正規化した語, 表記] の一覧
 * - text: 対象の発話をつないだテキスト（英字だけの語を数えるため）
 * - otherTexts: ほかの会話の全文。すべての会話に出てくる語は除き、
 *   同じ回数の語は、ほかの会話に出てこない語を先にする（TF-IDF）
 */
export function rankKeywords(
  ginzaTerms: [string, string][][],
  text: string,
  otherTexts: string[],
): RankedKeyword[] {
  const counts = new Map<string, number>();
  const surfaces = new Map<string, Map<string, number>>();
  const add = (norm: string, surface: string, n: number) => {
    counts.set(norm, (counts.get(norm) ?? 0) + n);
    const s = surfaces.get(norm) ?? new Map<string, number>();
    s.set(surface, (s.get(surface) ?? 0) + n);
    surfaces.set(norm, s);
  };
  for (const list of ginzaTerms) {
    for (const [norm, surface] of list) add(norm, surface, 1);
  }
  for (const [surface, n] of countRegexKeywords(text)) {
    const norm = normalizeTerm(surface);
    if (ASCII_ONLY.test(surface) && !counts.has(norm)) add(norm, surface, n);
  }

  const others = otherTexts.map((t) =>
    normalizeTerm(stripSoundTags(t)).replace(/ /g, ''),
  );
  const docCount = others.length + 1;
  const ranked: (RankedKeyword & { score: number })[] = [];
  for (const [norm, count] of counts) {
    if (GENERAL_WORDS.has(norm)) continue;
    const key = norm.replace(/ /g, '');
    const df = 1 + others.filter((o) => o.includes(key)).length;
    // ほかの会話がなければ比べられないため、回数で並べる
    const score =
      others.length === 0 ? count : count * Math.log((docCount + 1) / (df + 1));
    if (score <= 0) continue;
    ranked.push({ text: mostFrequent(surfaces.get(norm)!), count, score });
  }
  // 画面では回数を並べて見せるため、回数の多い順にする（同じ回数なら TF-IDF の高い順）
  ranked.sort((a, b) => b.count - a.count || b.score - a.score);
  return ranked.map(({ text: t, count }) => ({ text: t, count }));
}

/** いちばん多く出てきた表記（同じ回数なら先に出てきたもの） */
function mostFrequent(counts: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [text, n] of counts) {
    if (n > bestCount) {
      best = text;
      bestCount = n;
    }
  }
  return best;
}
