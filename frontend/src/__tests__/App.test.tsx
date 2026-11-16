import { render, screen } from '@testing-library/react';
import App from '../App';

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
});
