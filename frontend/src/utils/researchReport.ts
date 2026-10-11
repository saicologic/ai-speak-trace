import { marked } from 'marked';
import type { ReportCitation, ReportSegment } from '../types/research';
import { sanitizeHtml } from './sanitizeHtml';

/** 番号付きの根拠（同じ情報源・同じ引用は1つにまとめる） */
export interface NumberedCitation extends ReportCitation {
  number: number;
}

/** 本文に一時的に入れる根拠番号の目印 */
const MARKER = /⟦(\d+(?:,\d+)*)⟧/g;

/**
 * 統合分析の文と根拠から、根拠番号のリンク付きの HTML と、番号付きの根拠一覧を作る
 * 根拠番号は、根拠の付いた文の末尾（改行の前）に付ける
 */
export function buildReport(segments: ReportSegment[]): {
  html: string;
  citations: NumberedCitation[];
} {
  const citations: NumberedCitation[] = [];
  const numbers = new Map<string, number>();
  let markdown = '';
  for (const segment of segments) {
    const nums: number[] = [];
    for (const citation of segment.citations) {
      const key = `${citation.sourceId}\u0000${citation.citedText}`;
      let n = numbers.get(key);
      if (n === undefined) {
        n = citations.length + 1;
        numbers.set(key, n);
        citations.push({ ...citation, number: n });
      }
      if (!nums.includes(n)) nums.push(n);
    }
    if (nums.length === 0) {
      markdown += segment.text;
      continue;
    }
    const [, body, trailing] = segment.text.match(/^([\s\S]*?)(\s*)$/) ?? ['', segment.text, ''];
    markdown += `${body}⟦${nums.join(',')}⟧${trailing}`;
  }

  const doc = new DOMParser().parseFromString(
    sanitizeHtml(marked.parse(markdown, { async: false })),
    'text/html',
  );
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const text = node.textContent ?? '';
    if (!text.includes('⟦')) continue;
    const inCode = !!node.parentElement?.closest('code, pre');
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(MARKER)) {
      const start = match.index ?? 0;
      fragment.append(text.slice(last, start));
      last = start + match[0].length;
      if (inCode) continue;
      const sup = doc.createElement('sup');
      sup.className = 'research-cite';
      for (const n of match[1].split(',')) {
        const link = doc.createElement('a');
        link.href = `#research-citation-${n}`;
        link.dataset.citation = n;
        link.textContent = `[${n}]`;
        sup.append(link);
      }
      fragment.append(sup);
    }
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }
  return { html: doc.body.innerHTML, citations };
}
