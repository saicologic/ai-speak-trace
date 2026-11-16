import { render, screen } from '@testing-library/react';
import { PageLayout } from '../PageLayout';
import pageLayoutCss from '../PageLayout.css?raw';

/** CSS の文字列から、セレクターに書いた宣言を取り出す（コメントを除き、空白と改行を詰める） */
const declarationsOf = (css: string, selector: string): string => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = withoutComments.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
};

describe('PageLayout', () => {
  it('ヘッダーは固定する部分に、中身はスクロールする部分に描く', () => {
    const { container } = render(
      <PageLayout header={<h1>会話分析</h1>}>
        <p>本文</p>
      </PageLayout>,
    );

    const fixed = container.querySelector('.page-layout-fixed');
    const scroll = container.querySelector('.page-layout-scroll');
    expect(fixed).toContainElement(screen.getByRole('heading', { name: '会話分析' }));
    expect(scroll).toContainElement(screen.getByText('本文'));
    expect(fixed).not.toContainElement(screen.getByText('本文'));
    // クラス名を渡さないときは、外枠のクラスは page-layout だけにする
    expect(container.firstElementChild).toHaveClass('page-layout', { exact: true });
  });

  it('ページごとのクラス名を外枠に付ける', () => {
    const { container } = render(
      <PageLayout className="settings-page" header={<h1>設定</h1>}>
        <p>本文</p>
      </PageLayout>,
    );

    expect(container.firstElementChild).toHaveClass('page-layout', 'settings-page');
  });
});

describe('PageLayout.css', () => {
  it('外枠は画面の高さに合わせ、外枠そのものはスクロールさせない', () => {
    const root = declarationsOf(pageLayoutCss, '.page-layout');
    expect(root).toContain('display: flex;');
    expect(root).toContain('height: 100vh;');
    expect(root).toContain('overflow: hidden;');
    expect(root).toContain('flex-direction: column;');
  });

  it('固定する部分は、中身が長くても縮まない', () => {
    expect(declarationsOf(pageLayoutCss, '.page-layout-fixed')).toContain('flex-shrink: 0;');
  });

  it('スクロールする部分は、残りの高さを使い、中身が長いときだけスクロールする', () => {
    const scroll = declarationsOf(pageLayoutCss, '.page-layout-scroll');
    expect(scroll).toContain('flex: 1;');
    expect(scroll).toContain('min-height: 0;');
    expect(scroll).toContain('overflow-y: auto;');
    // 一覧と詳細を並べる画面で、子を高さいっぱいに広げられるようにする
    expect(scroll).toContain('display: flex;');
    expect(scroll).toContain('flex-direction: column;');
  });
});
