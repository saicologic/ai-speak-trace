import { marked } from 'marked';
import type { ReportCitation, ReportSegment } from '../types/research';
import { sanitizeHtml } from './sanitizeHtml';

/** 番号付きの根拠（同じ情報源・同じ引用は1つにまとめる） */
export interface NumberedCitation extends ReportCitation {
  number: number;
}

/** 本文に一時的に入れる出典の目印（中身は出典ごとの根拠番号を「;」で区切ったもの） */
const MARKER = /⟦([\d,;]+)⟧/g;

/**
 * 統合分析を論点（「## 見出し」）ごとに分ける（最初の見出しより前の文は、見出しなしの論点にする）
 * 見出しは行ごとに探す（評価で除いた文から残した見出しは、空行や項目名と一緒の断片になっているため）
 */
export function splitTopics(segments: ReportSegment[]): { title: string | null; segments: ReportSegment[] }[] {
  const topics: { title: string | null; segments: ReportSegment[] }[] = [];
  const append = (segment: ReportSegment) => {
    if (topics.length === 0) topics.push({ title: null, segments: [] });
    topics[topics.length - 1].segments.push(segment);
  };
  for (const segment of segments) {
    // 根拠の付いた文は、根拠を保つために分けない
    const headings = segment.citations.length === 0 ? [...segment.text.matchAll(/^#{1,6}\s+(.+)$/gm)] : [];
    if (headings.length === 0) {
      append(segment);
      continue;
    }
    const before = segment.text.slice(0, headings[0].index);
    if (before.trim()) append({ text: before, citations: [] });
    headings.forEach((heading, i) => {
      const end = headings[i + 1]?.index ?? segment.text.length;
      topics.push({
        title: heading[1].trim(),
        segments: [{ text: segment.text.slice(heading.index, end), citations: [] }],
      });
    });
  }
  return topics;
}

/**
 * 統合分析の文と根拠から、出典の表示付きの HTML と、番号付きの根拠を作る
 * 出典は、根拠の付いた文の末尾（改行の前）に「会話1 34:19」のような短い表示で付ける
 * 1つの文に同じ表示の根拠が複数ある場合は、1つの表示にまとめる（クリックすると、まとめた根拠を全部見られる）
 *
 * @param label 根拠の短い表示（例: 「会話1 34:19」「langchain.com 公式」）
 */
export function buildReport(
  segments: ReportSegment[],
  label: (citation: ReportCitation) => string,
): {
  html: string;
  citations: NumberedCitation[];
} {
  const citations: NumberedCitation[] = [];
  const numbers = new Map<string, number>();
  let markdown = '';
  for (const segment of segments) {
    // 表示ごとに根拠番号をまとめる（表示の順を保つ）
    const groups = new Map<string, number[]>();
    for (const citation of segment.citations) {
      const key = `${citation.sourceId}\u0000${citation.citedText}`;
      let n = numbers.get(key);
      if (n === undefined) {
        n = citations.length + 1;
        numbers.set(key, n);
        citations.push({ ...citation, number: n });
      }
      const group = groups.get(label(citation)) ?? [];
      if (!group.includes(n)) group.push(n);
      groups.set(label(citation), group);
    }
    if (groups.size === 0) {
      markdown += segment.text;
      continue;
    }
    const [, body, trailing] = segment.text.match(/^([\s\S]*?)(\s*)$/) ?? ['', segment.text, ''];
    const marker = Array.from(groups.values())
      .map((nums) => nums.join(','))
      .join(';');
    markdown += `${body}⟦${marker}⟧${trailing}`;
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
      for (const group of match[1].split(';')) {
        const nums = group.split(',').map(Number);
        const first = citations[nums[0] - 1];
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = `research-cite ${first.sourceKind}`;
        chip.dataset.citations = group;
        chip.textContent = label(first);
        fragment.append(chip);
      }
    }
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }

  return { html: doc.body.innerHTML, citations };
}
