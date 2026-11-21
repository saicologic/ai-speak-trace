import { render, screen } from '@testing-library/react';
import { PageLayout } from '../PageLayout';
import { allCss, classesOf, cssFilesSelecting } from '../../test/cssRules';

const renderLayout = (className?: string) =>
  render(
    <PageLayout className={className} header={<h1>会話分析</h1>}>
      <p>本文</p>
    </PageLayout>,
  );

describe('PageLayout', () => {
  it('ヘッダーは固定する部分に、中身はスクロールする部分に描く', () => {
    const { container } = renderLayout();

    const fixed = container.querySelector('.page-layout-fixed');
    const scroll = container.querySelector('.page-layout-scroll');
    expect(fixed).toContainElement(screen.getByRole('heading', { name: '会話分析' }));
    expect(scroll).toContainElement(screen.getByText('本文'));
    expect(fixed).not.toContainElement(screen.getByText('本文'));
  });

  it('外枠は画面の高さに合わせ、外枠そのものはスクロールさせない', () => {
    const { container } = renderLayout();

    // クラス名を渡さないときは、外枠のクラスは、目印の page-layout と、高さ・並べ方のクラスだけにする
    expect(classesOf(container.firstElementChild)).toEqual(
      ['page-layout', 'flex', 'h-screen', 'flex-col', 'overflow-hidden'].sort(),
    );
  });

  it('固定する部分は、中身が長くても縮まない', () => {
    const { container } = renderLayout();

    expect(classesOf(container.querySelector('.page-layout-fixed'))).toEqual(
      ['page-layout-fixed', 'shrink-0'].sort(),
    );
  });

  it('スクロールする部分は、残りの高さを使い、中身が長いときだけスクロールする', () => {
    const { container } = renderLayout();

    // 一覧と詳細を並べる画面で、子を高さいっぱいに広げられるように、縦に並べる
    expect(classesOf(container.querySelector('.page-layout-scroll'))).toEqual(
      ['page-layout-scroll', 'flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-y-auto'].sort(),
    );
  });

  it('ページごとのクラス名を、外枠のクラスを残したまま足す', () => {
    const { container } = renderLayout('settings-page');

    expect(classesOf(container.firstElementChild)).toEqual(
      ['page-layout', 'flex', 'h-screen', 'flex-col', 'overflow-hidden', 'settings-page'].sort(),
    );
  });

  it('PageLayout.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/PageLayout.css');
    // 探し方がまちがっていないことを、ほかの画面の CSS が見つかることで確かめる
    expect(Object.keys(allCss)).toContain('components/SettingsPage.css');
  });

  it('ほかの CSS ファイルでも、目印のクラスに見た目を指定しない', () => {
    for (const name of ['page-layout', 'page-layout-fixed', 'page-layout-scroll']) {
      expect(cssFilesSelecting(name)).toEqual([]);
    }
    // 探し方がまちがっていないことを、画面の CSS のクラスが見つかることと、src の直下の CSS も読んでいることで確かめる
    expect(cssFilesSelecting('settings-page')).toEqual(['components/SettingsPage.css']);
    expect(Object.keys(allCss)).toEqual(expect.arrayContaining(['App.css', 'index.css']));
  });
});
