import type { ReportSegment } from '../types/research';
import { organizationOf, RELATED_LINK_RULES, selectRelatedLinks } from './relatedLinks';

/** 指定した URL を、指定した回数ずつ根拠に使った論点 */
const segments = (pages: { url: string; count: number; official?: boolean }[]): ReportSegment[] =>
  pages.flatMap(({ url, count, official }) =>
    Array.from({ length: count }, () => ({
      text: '文。',
      citations: [{ sourceKind: 'web' as const, sourceId: url, title: url, citedText: '抜粋', official }],
    })),
  );

const urls = (s: ReportSegment[]) => selectRelatedLinks(s).map((l) => l.citation.sourceId);

describe('organizationOf', () => {
  it('サブドメインを除いて組織を取り出す', () => {
    expect(organizationOf('https://docs.anthropic.com/ja/docs')).toBe('anthropic.com');
    expect(organizationOf('https://resources.anthropic.com/a')).toBe('anthropic.com');
    expect(organizationOf('https://www.ibm.com/think')).toBe('ibm.com');
  });

  it('国別の2段のドメインは、その1つ上までを組織とする', () => {
    expect(organizationOf('https://www.oreilly.co.jp/books/1')).toBe('oreilly.co.jp');
    expect(organizationOf('https://techblog.zozo.com/a')).toBe('zozo.com');
    expect(organizationOf('https://news.bbc.co.uk/a')).toBe('bbc.co.uk');
  });
});

describe('selectRelatedLinks', () => {
  it('公式サイトのページがあれば、公式だけを表示する', () => {
    expect(
      urls(
        segments([
          { url: 'https://general.com/a', count: 5 },
          { url: 'https://www.oreilly.co.jp/books/1', count: 2, official: true },
        ]),
      ),
    ).toEqual(['https://www.oreilly.co.jp/books/1']);
  });

  it('公式サイトのページがなければ、一般の記事から選ぶ。2件目からは根拠に2回以上使ったページだけ', () => {
    expect(
      urls(
        segments([
          { url: 'https://mindstudio.ai/a', count: 4 },
          { url: 'https://www.ibm.com/think/a', count: 4 },
          { url: 'https://ailead.app/a', count: 1 },
          { url: 'https://zenn.dev/a', count: 1 },
        ]),
      ),
    ).toEqual(['https://mindstudio.ai/a', 'https://www.ibm.com/think/a']);
  });

  it('同じ組織のページは、根拠に多く使った1件だけを表示する', () => {
    expect(
      urls(
        segments([
          { url: 'https://www.anthropic.com/engineering/a', count: 8, official: true },
          { url: 'https://www.anthropic.com/engineering/b', count: 2, official: true },
          { url: 'https://docs.anthropic.com/c', count: 3, official: true },
        ]),
      ),
    ).toEqual(['https://www.anthropic.com/engineering/a']);
  });

  it('最大件数までにする', () => {
    expect(
      urls(
        segments([
          { url: 'https://a.com/1', count: 5, official: true },
          { url: 'https://b.com/1', count: 4, official: true },
          { url: 'https://c.com/1', count: 3, official: true },
          { url: 'https://d.com/1', count: 2, official: true },
        ]),
      ),
    ).toHaveLength(RELATED_LINK_RULES.maxLinks);
  });

  it('根拠が1回しかないページでも、1件目は表示する。Web の根拠がなければ表示しない', () => {
    expect(urls(segments([{ url: 'https://a.com/1', count: 1 }]))).toEqual(['https://a.com/1']);
    expect(urls([{ text: '会話だけの文。', citations: [] }])).toEqual([]);
  });

  it('根拠に使った回数を返す', () => {
    expect(selectRelatedLinks(segments([{ url: 'https://a.com/1', count: 3 }]))[0].count).toBe(3);
  });
});
