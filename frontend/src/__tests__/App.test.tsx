import { render, screen } from '@testing-library/react';
import App from '../App';
import { allCss, classesOf, cssFilesSelecting } from '../test/cssRules';

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
    // 探し方がまちがっていないことを、残す CSS（index.css）が見つかることで確かめる
    // （クラスを見つけられることは、src/test/cssRules.test.ts で確かめる）
    expect(Object.keys(allCss)).toContain('index.css');
  });
});

describe('トップ画面の見た目', () => {
  it('画面の高さに合わせて縦に並べ、ヘッダーは紺にする', () => {
    const { container } = render(<App />);
    expect(container.firstElementChild).toHaveClass('flex', 'h-screen', 'flex-col');
    const title = screen.getByRole('heading', { name: 'AI Speak Trace', level: 1 });
    expect(title).toHaveClass('mb-1', 'text-2xl');
    expect(screen.getByText('音声データの話者分離・文字起こし')).toHaveClass('text-md', 'text-brand-muted');
    expect(title.parentElement?.parentElement).toHaveClass('flex', 'items-center', 'justify-between', 'bg-brand', 'px-8', 'py-4', 'text-white');
  });

  it('「設定」ボタンは青紫にし、カーソルを乗せると濃くし、押すと少し縮める', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '設定' })).toHaveClass(
      'rounded-lg',
      'border-none',
      'bg-[#4f6ef7]',
      'text-md',
      'font-semibold',
      'tracking-[0.02em]',
      'text-white',
      'hover:bg-[#3b5be0]',
      'active:scale-[0.97]',
    );
  });

  it('サイドバーのボタンは青い横いっぱいのボタンにし、押せないときは灰色にする', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: '音声ファイルの文字起こし' });
    expect(button).toHaveClass(
      'w-full',
      'rounded-lg',
      'border-none',
      'bg-primary',
      'text-md',
      'font-semibold',
      'text-white',
      'enabled:hover:bg-primary-hover',
      'disabled:bg-gray-200',
      'disabled:text-gray-400',
    );
    expect(button.parentElement).toHaveClass('mb-4');
  });

  it('文字起こしを選んでいないときは、灰色の文字で案内を出す', () => {
    render(<App />);
    expect(screen.getByText('文字起こし履歴を選択してください').parentElement).toHaveClass(
      'flex',
      'items-center',
      'justify-center',
      'px-8',
      'py-16',
      'text-lg',
      'text-gray-400',
    );
  });

  it('App.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('App.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
