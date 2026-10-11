import { describe, it, expect } from 'vitest';
import { buildReport, splitTopics, topicHighlights } from './researchReport';
import type { ReportCitation } from '../types/research';

const conv: ReportCitation = { sourceKind: 'conversation', sourceId: 't1', title: '前編.mp3', citedText: '原文' };
const web: ReportCitation = {
  sourceKind: 'web',
  sourceId: 'https://example.com',
  title: '公式',
  citedText: '抜粋',
  official: true,
};

/** テスト用の短い表示 */
const label = (c: ReportCitation) => (c.sourceKind === 'conversation' ? '会話1' : 'example.com 公式');

describe('buildReport', () => {
  it('根拠の付いた文の末尾に出典の短い表示を付け、同じ根拠は同じ番号にする', () => {
    const { html, citations } = buildReport(
      [
        { text: '## 論点\n\n', citations: [] },
        { text: '会話ではこう語られた。', citations: [conv] },
        { text: '公式でも同じ説明がある。\n', citations: [web, conv] },
      ],
      label,
    );
    expect(citations.map((c) => [c.number, c.title])).toEqual([
      [1, '前編.mp3'],
      [2, '公式'],
    ]);
    expect(html).toContain('<h2>論点</h2>');
    expect(html).toContain(
      '会話ではこう語られた。<button type="button" class="research-cite conversation" data-citations="1">会話1</button>',
    );
    expect(html).toContain(
      '<button type="button" class="research-cite web" data-citations="2">example.com 公式</button><button type="button" class="research-cite conversation" data-citations="1">会話1</button>',
    );
    expect(html).not.toContain('⟦');
  });

  it('1つの文に同じ表示の根拠が複数ある場合は、1つの表示にまとめる', () => {
    const other: ReportCitation = { ...conv, citedText: '別の原文' };
    const { html } = buildReport([{ text: '会話で何度も語られた。', citations: [conv, other] }], label);
    expect(html).toContain('data-citations="1,2">会話1</button>');
    expect(html.match(/research-cite/g)).toHaveLength(1);
  });

  it('AI の出力に含まれるスクリプトは取り除く', () => {
    const { html } = buildReport([{ text: '本文<script>alert(1)</script>', citations: [conv] }], label);
    expect(html).not.toContain('script');
    expect(html).toContain('会話1');
  });

  it('統合分析を論点の見出しごとに分ける', () => {
    const topics = splitTopics([
      { text: '前置き。', citations: [] },
      { text: '## ハーネス\n\n', citations: [] },
      { text: '定義。', citations: [web] },
      { text: '## ループ\n', citations: [] },
      { text: '説明。', citations: [] },
    ]);
    expect(topics.map((t) => [t.title, t.segments.length])).toEqual([
      [null, 1],
      ['ハーネス', 2],
      ['ループ', 2],
    ]);
  });

  it('空行や項目名と一緒の断片に含まれる見出しも、行ごとに探して別の論点に分ける', () => {
    const topics = splitTopics([
      { text: '## ハーネス\n\n', citations: [] },
      { text: '定義。', citations: [web] },
      { text: '\n\n## ループ\n\n**詳しく**\n## 評価\n', citations: [] },
      { text: '説明。', citations: [] },
    ]);
    expect(topics.map((t) => [t.title, t.segments.map((s) => s.text)])).toEqual([
      ['ハーネス', ['## ハーネス\n\n', '定義。']],
      ['ループ', ['## ループ\n\n**詳しく**\n']],
      ['評価', ['## 評価\n', '説明。']],
    ]);
  });
});

describe('topicHighlights', () => {
  it('「一言でいうと」の文を取り出す', () => {
    const { oneLiner, hasDifference } = topicHighlights([
      { text: '## ハーネス\n\n**一言でいうと**: モデルを動かす', citations: [] },
      { text: '仕組みです。\n\n**詳しく**:\n- 説明', citations: [] },
    ]);
    expect(oneLiner).toBe('モデルを動かす仕組みです。');
    expect(hasDifference).toBe(false);
  });

  it('「会話での説明との違い」があるかを見る', () => {
    const { oneLiner, hasDifference } = topicHighlights([
      { text: '## ハーネス\n\n**詳しく**:\n- 説明\n\n**会話での説明との違い**: 会話では…', citations: [] },
    ]);
    expect(oneLiner).toBeNull();
    expect(hasDifference).toBe(true);
  });
});
