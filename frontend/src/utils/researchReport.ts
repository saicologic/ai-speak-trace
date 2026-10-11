import { marked } from 'marked';
import type { ReportCitation, ReportSegment } from '../types/research';
import { sanitizeHtml } from './sanitizeHtml';

/** 番号付きの根拠（同じ情報源・同じ引用は1つにまとめる） */
export interface NumberedCitation extends ReportCitation {
  number: number;
}

/** 統合分析の論点（「## 見出し」） */
export interface ReportTopic {
  id: string;
  title: string;
}

/** 本文に一時的に入れる出典の目印（中身は出典ごとの根拠番号を「;」で区切ったもの） */
const MARKER = /⟦([\d,;]+)⟧/g;

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
  topics: ReportTopic[];
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

  // 論点の見出しに ID を付け、目次から移動できるようにする
  const topics: ReportTopic[] = [];
  doc.body.querySelectorAll('h2').forEach((h2, i) => {
    h2.id = `research-topic-${i + 1}`;
    topics.push({ id: h2.id, title: h2.textContent?.trim() ?? '' });
  });
  return { html: doc.body.innerHTML, citations, topics };
}
