import { render, screen } from '@testing-library/react';
import { PageLayout } from '../PageLayout';

/** components のフォルダの CSS ファイル（Tailwind に移した部品の CSS が残っていないかを確かめる） */
const componentCssFiles = Object.keys(import.meta.glob('../*.css'));

/** 要素のクラスを、並びを問わない集まりにする */
const classesOf = (element: Element | null): string[] =>
  element ? Array.from(element.classList).sort() : [];

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
    expect(componentCssFiles).not.toContain('../PageLayout.css');
    // 探し方がまちがっていないことを、ほかの画面の CSS が見つかることで確かめる
    expect(componentCssFiles).toContain('../SettingsPage.css');
  });
});
