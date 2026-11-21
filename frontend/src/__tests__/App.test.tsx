import { render, screen } from '@testing-library/react';
import App from '../App';
import appCss from '../App.css?raw';
import { classesOf, cssFilesSelecting } from '../test/cssRules';

/**
 * トップ画面の左のサイドバーの見た目のテスト
 * 見た目の確認だけなので、API は返事をしないままにする（読み込み中の画面で確かめる）
 */
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn(() => new Promise(() => {})) : value,
    ]),
  );
});

describe('トップ画面の左のサイドバー', () => {
  it('「文字起こし履歴」の見出しだけを出し、同じ意味の「履歴」は出さない', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '文字起こし履歴' })).toBeInTheDocument();
    expect(screen.queryByText('履歴', { exact: true })).not.toBeInTheDocument();
  });

  it('文字起こし履歴は、サイドバーの直接の子に置く（間に箱があると、残りの高さを使えず、一覧だけをスクロールできない）', () => {
    const { container } = render(<App />);

    const list = container.querySelector('.transcription-list');
    expect(list).not.toBeNull();
    expect(list?.parentElement).toBe(container.querySelector('.app-sidebar'));
  });

  it('サイドバーは縦に並べ、入りきらないときだけ全体をスクロールする（ふだんは文字起こし履歴の一覧だけがスクロールする）', () => {
    const { container } = render(<App />);

    // app-sidebar は、文字起こし履歴がサイドバーの直接の子であることを確かめるための目印
    expect(classesOf(container.querySelector('aside.app-sidebar'))).toEqual(
      [
        'app-sidebar',
        'flex',
        'w-[280px]',
        'min-w-[280px]',
        'flex-col',
        'overflow-y-auto',
        'border-r',
        'border-gray-200',
        'bg-white',
        'p-4',
      ].sort(),
    );
  });

  it('CSS ファイルに .app-sidebar の指定を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(cssFilesSelecting('app-sidebar')).toEqual([]);
    // 探し方がまちがっていないことを、右のサイドバーの指定が見つかることで確かめる
    expect(cssFilesSelecting('app-sidebar-right')).toEqual(['App.css']);
    expect(appCss).toContain('.app-sidebar-right');
  });
});
