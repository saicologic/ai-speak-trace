import { describe, it, expect } from 'vitest';
import { buildReport } from './researchReport';
import type { ReportCitation } from '../types/research';

const conv: ReportCitation = { sourceKind: 'conversation', sourceId: 't1', title: '前編.mp3', citedText: '原文' };
const web: ReportCitation = {
  sourceKind: 'web',
  sourceId: 'https://example.com',
  title: '公式',
  citedText: '抜粋',
  official: true,
};

describe('buildReport', () => {
  it('根拠の付いた文の末尾に番号のリンクを付け、同じ根拠は同じ番号にする', () => {
    const { html, citations } = buildReport([
      { text: '## 論点\n\n', citations: [] },
      { text: '会話ではこう語られた。', citations: [conv] },
      { text: '公式でも同じ説明がある。\n', citations: [web, conv] },
    ]);
    expect(citations.map((c) => [c.number, c.title])).toEqual([
      [1, '前編.mp3'],
      [2, '公式'],
    ]);
    expect(html).toContain('<h2>論点</h2>');
    expect(html).toContain(
      '会話ではこう語られた。<sup class="research-cite"><a href="#research-citation-1" data-citation="1">[1]</a></sup>',
    );
    expect(html).toContain(
      '<a href="#research-citation-2" data-citation="2">[2]</a><a href="#research-citation-1" data-citation="1">[1]</a>',
    );
    expect(html).not.toContain('⟦');
  });

  it('AI の出力に含まれるスクリプトは取り除く', () => {
    const { html } = buildReport([{ text: '本文<script>alert(1)</script>', citations: [conv] }]);
    expect(html).not.toContain('script');
    expect(html).toContain('[1]');
  });
});
