import type Anthropic from '@anthropic-ai/sdk';
import { Transcription } from '../transcription/types/transcription.types';
import {
  EthicsCheck,
  ReportCitation,
  ReportSegment,
  TranscriptQuote,
  TranscriptUtterance,
  WebSource,
} from './types/research.types';

/** 比較用に空白を除き、全角・半角をそろえる */
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '');
}

/** 会話を Claude に渡す文書の本文にする（1行1発言、話者付き） */
export function toTranscriptDocument(transcription: Transcription): string {
  return transcription.utterances
    .filter((u) => u.text.trim())
    .map((u) => `${u.speakerName}: ${u.text}`)
    .join('\n');
}

/** 統合分析に渡す発言（空の発言は除き、文字起こしでの位置を残す） */
export function toTranscriptUtterances(
  transcription: Transcription,
): TranscriptUtterance[] {
  return transcription.utterances.flatMap((u, index) =>
    u.text.trim()
      ? [{ index, speakerName: u.speakerName, start: u.start, text: u.text }]
      : [],
  );
}

/** 選んだ会話全体でのキーワードの出現回数（空白・全角半角の違いは無視） */
export function countOccurrences(
  transcriptions: Transcription[],
  keyword: string,
): number {
  const target = normalize(keyword);
  if (!target) return 0;
  let count = 0;
  for (const t of transcriptions) {
    const text = normalize(t.utterances.map((u) => u.text).join(''));
    let from = 0;
    for (;;) {
      const i = text.indexOf(target, from);
      if (i < 0) break;
      count++;
      from = i + target.length;
    }
  }
  return count;
}

/**
 * Claude が提案の根拠として挙げた引用のうち、実際の発言に含まれるものだけを残す
 * （言い換えや作り話の引用を、根拠として表示しないため）
 */
export function verifyQuotes(
  quotes: string[],
  transcriptions: Transcription[],
): TranscriptQuote[] {
  const verified: TranscriptQuote[] = [];
  for (const quote of quotes) {
    const target = normalize(quote);
    if (!target) continue;
    for (const t of transcriptions) {
      const utterance = t.utterances.find((u) =>
        normalize(u.text).includes(target),
      );
      if (utterance) {
        verified.push({
          transcriptionId: t.id,
          speakerName: utterance.speakerName,
          text: quote,
        });
        break;
      }
    }
  }
  return verified;
}

/** ドメイン指定を比較できる形にする（https:// や末尾の / を外す） */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

/** URL のホスト名 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** URL が、確定した公式サイトのドメイン（またはそのサブドメイン）か */
export function isOfficial(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return domains
    .map(normalizeDomain)
    .some((d) => d && (host === d || host.endsWith(`.${d}`)));
}

/**
 * Web検索の応答から、検索でヒットした記事と、回答に引用された本文の抜粋を集める
 */
export function collectWebSources(
  content: Anthropic.ContentBlock[],
  officialDomains: string[],
): WebSource[] {
  const byUrl = new Map<string, WebSource>();
  const get = (url: string, title: string | null): WebSource => {
    let source = byUrl.get(url);
    if (!source) {
      source = {
        url,
        title: title || url,
        domain: hostOf(url),
        official: isOfficial(url, officialDomains),
        excerpts: [],
      };
      byUrl.set(url, source);
    }
    return source;
  };
  for (const block of content) {
    if (
      block.type === 'web_search_tool_result' &&
      Array.isArray(block.content)
    ) {
      for (const result of block.content) get(result.url, result.title);
    }
    if (block.type === 'text') {
      for (const citation of block.citations ?? []) {
        if (citation.type !== 'web_search_result_location') continue;
        const excerpt = citation.cited_text.trim();
        const source = get(citation.url, citation.title);
        if (excerpt && !source.excerpts.includes(excerpt)) {
          source.excerpts.push(excerpt);
        }
      }
    }
  }
  return Array.from(byUrl.values());
}

/** 統合分析に渡した文書の、元の情報源 */
export interface AnalysisDocument {
  sourceKind: 'conversation' | 'web';
  sourceId: string;
  title: string;
  official?: boolean;
  /** 会話の場合、ブロックの順に並べた発言（引用されたブロックを発言に対応づける） */
  utterances?: TranscriptUtterance[];
}

/**
 * Citations 付きの応答を、文と根拠の組（ReportSegment）に変換する
 * 根拠の document_index を、渡した文書の情報源に対応づける
 */
export function toReportSegments(
  content: Anthropic.ContentBlock[],
  documents: AnalysisDocument[],
): ReportSegment[] {
  const segments: ReportSegment[] = [];
  for (const block of content) {
    if (block.type !== 'text' || !block.text) continue;
    const citations: ReportCitation[] = [];
    for (const citation of block.citations ?? []) {
      if (
        citation.type !== 'char_location' &&
        citation.type !== 'page_location' &&
        citation.type !== 'content_block_location'
      ) {
        continue;
      }
      const doc = documents[citation.document_index];
      if (!doc) continue;
      // 会話の引用は、引用された最初の発言の位置・話者・時刻を残す（元の文字起こしへ移動するため）
      const blocks =
        citation.type === 'content_block_location'
          ? { start: citation.start_block_index, end: citation.end_block_index }
          : null;
      const utterance = blocks ? doc.utterances?.[blocks.start] : undefined;
      citations.push({
        sourceKind: doc.sourceKind,
        sourceId: doc.sourceId,
        title: doc.title,
        citedText: citation.cited_text,
        ...(doc.sourceKind === 'web' && { official: doc.official }),
        ...(utterance && {
          utterance: {
            index: utterance.index,
            speakerName: utterance.speakerName,
            start: utterance.start,
            count: Math.max(1, blocks!.end - blocks!.start),
          },
        }),
      });
    }
    segments.push({ text: block.text, citations });
  }
  return mergeIntoSentences(segments);
}

/** 文の区切り（句点・感嘆符・疑問符と閉じかっこ、または改行）で終わるか */
const SENTENCE_END = /(?:[。！？!?][」』）)]*[^\S\n]*|\n)$/;

/** 断片を、文の区切りの直後で分ける */
const SENTENCE_PIECE =
  /[^。！？!?\n]*(?:[。！？!?]+[」』）)]*[^\S\n]*\n*|\n+)|[^。！？!?\n]+$/g;

/**
 * Citations の応答は根拠の境目で区切られ、「と述べた。」のような文の切れ端が根拠なしの断片になる
 * 断片のまま審査すると、切れ端が根拠のない主張として除かれ、前後の文がつながらなくなる
 * また、1つの断片に複数の文が入ることもあり、そのままでは文ごとに判定できない
 * そのため、断片を文の区切りで分けたうえで、文の区切りまでつないで、1文を1つの単位にする
 * 分けた文は、元の断片の根拠を引き継ぐ
 */
export function mergeIntoSentences(segments: ReportSegment[]): ReportSegment[] {
  const pieces = segments.flatMap((segment) =>
    (segment.text.match(SENTENCE_PIECE) ?? [])
      .filter((text) => text.length > 0)
      .map((text) => ({ text, citations: segment.citations })),
  );
  const merged: ReportSegment[] = [];
  let current: ReportSegment | null = null;
  for (const piece of pieces) {
    current = current
      ? {
          text: current.text + piece.text,
          citations: [...current.citations, ...piece.citations],
        }
      : { text: piece.text, citations: [...piece.citations] };
    if (SENTENCE_END.test(current.text)) {
      merged.push(current);
      current = null;
    }
  }
  if (current) merged.push(current);
  // 箇条書きの項目が前の文に続けて書かれた場合は、改行を補って別の項目として表示する
  return merged.map((segment, i) =>
    i > 0 && /^[-*]\s/.test(segment.text) && !merged[i - 1].text.endsWith('\n')
      ? { ...segment, text: `\n${segment.text}` }
      : segment,
  );
}

/** 個人を特定できる連絡先などを、ルールで検出する */
const PERSONAL_DATA_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: 'メールアドレス',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  },
  {
    label: '電話番号',
    pattern: /(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}(?!\d)/,
  },
  {
    label: 'クレジットカード番号らしき数字',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
  },
];

/** 統合分析の本文に、連絡先などの個人情報が含まれていないか */
export function checkPersonalData(segments: ReportSegment[]): EthicsCheck {
  const text = segments.map((s) => s.text).join('');
  const found = PERSONAL_DATA_PATTERNS.filter((p) => p.pattern.test(text)).map(
    (p) => p.label,
  );
  return {
    item: '個人情報（連絡先など）が含まれていない',
    passed: found.length === 0,
    detail:
      found.length === 0 ? '検出されませんでした' : `検出: ${found.join('、')}`,
  };
}
