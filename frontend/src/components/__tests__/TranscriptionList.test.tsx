import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TranscriptionList } from '../TranscriptionList';
import { allCss, classesOf, cssFilesSelecting } from '../../test/cssRules';
import { deleteTranscription, fetchTranscriptions } from '../../api/client';
import { confirmDialog } from '../../utils/platform';

vi.mock('../../api/client');
vi.mock('../../utils/platform');

const items = [
  { id: 't1', audioFileName: 'a.mp3', createdAt: '2026-10-11T00:00:00.000Z' },
  { id: 't2', audioFileName: 'b.mp3', createdAt: '2026-10-11T01:00:00.000Z' },
];

describe('TranscriptionList の削除', () => {
  beforeEach(() => {
    vi.mocked(fetchTranscriptions).mockReset().mockResolvedValue(items as never);
    vi.mocked(deleteTranscription).mockReset().mockResolvedValue(undefined);
    vi.mocked(confirmDialog).mockReset();
  });

  it('確認のうえで削除し、一覧から除いて呼び出し元に知らせる', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    const onDeleted = vi.fn();
    render(
      <TranscriptionList selectedId="t1" onSelect={vi.fn()} onDeleted={onDeleted} loading={false} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' }));

    await waitFor(() => expect(deleteTranscription).toHaveBeenCalledWith('t1'));
    expect(vi.mocked(confirmDialog).mock.calls[0][0]).toContain(
      '外部サービス（ElevenLabs・Anthropic・AWS）に送信済みのデータは、このアプリからは削除できません',
    );
    await waitFor(() => expect(screen.queryByText('a.mp3')).not.toBeInTheDocument());
    expect(screen.getByText('b.mp3')).toBeInTheDocument();
    expect(onDeleted).toHaveBeenCalledWith('t1');
  });

  it('確認で取り消した場合は削除しない', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(deleteTranscription).not.toHaveBeenCalled();
    expect(screen.getByText('a.mp3')).toBeInTheDocument();
  });

  it('削除に失敗したらエラーを表示し、一覧に残す', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    vi.mocked(deleteTranscription).mockRejectedValue(new Error('ログを削除できませんでした'));
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' }));

    expect(await screen.findByText('ログを削除できませんでした')).toBeInTheDocument();
    expect(screen.getByText('a.mp3')).toBeInTheDocument();
  });
});

/** 音声ファイルの名前のボタン（項目）を探す */
const itemButton = (name: string) => screen.getByText(name).closest('button');

/**
 * トップ画面の左のサイドバーの文字起こし履歴
 * 「文字起こし履歴」の見出しは固定し、音声ファイルの一覧だけをスクロールする。
 * 画面が低くても、一覧を見られる高さ（160px）は保つ（保てないときは、サイドバー全体がスクロールする）
 */
describe('TranscriptionList の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchTranscriptions).mockReset().mockResolvedValue(items as never);
    vi.mocked(deleteTranscription).mockReset();
    vi.mocked(confirmDialog).mockReset();
  });

  it('文字起こし履歴は、サイドバーの残りの高さを使い、画面が低くても一覧を見られる高さを保つ', async () => {
    const { container } = render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);
    await screen.findByText('a.mp3');

    // transcription-list は、サイドバーの直接の子であることを確かめるための目印
    expect(classesOf(container.firstElementChild)).toEqual(
      ['transcription-list', 'flex', 'min-h-40', 'flex-1', 'flex-col'].sort(),
    );
  });

  it('「文字起こし履歴」と更新ボタンの行は、一覧が長くても縮まない', async () => {
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);
    await screen.findByText('a.mp3');

    const header = screen.getByRole('heading', { name: '文字起こし履歴', level: 2 }).parentElement;
    expect(header).toHaveClass('shrink-0', 'flex', 'items-center', 'justify-between');
    expect(header).toContainElement(screen.getByRole('button', { name: '更新' }));
  });

  it('「更新」ボタンは、見出しの行に合わせて、ふつうのボタンより小さくする', async () => {
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);
    await screen.findByText('a.mp3');

    // 小さくする指定（.reload-button）は、どこからも読み込まない AudioFileList.css にしかなく、効いていなかった
    expect(classesOf(screen.getByRole('button', { name: '更新' }))).toEqual(
      ['text-xs', 'px-[0.6em]', 'py-[0.3em]'].sort(),
    );
  });

  it('音声ファイルの一覧だけが、長いときにスクロールする', async () => {
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);
    await screen.findByText('a.mp3');

    expect(classesOf(screen.getByRole('list'))).toEqual(
      ['min-h-0', 'flex-1', 'list-none', 'overflow-y-auto'].sort(),
    );
  });

  it('選んでいない項目は、カーソルを乗せると緑にする', async () => {
    render(<TranscriptionList selectedId="t1" onSelect={vi.fn()} loading={false} />);
    await screen.findByText('b.mp3');

    const item = itemButton('b.mp3');
    expect(item).toHaveClass('border-gray-200', 'bg-white', 'hover:border-green-300', 'hover:bg-green-50');
    expect(item).not.toHaveClass('border-green-500');
  });

  it('選んだ項目は濃い緑の枠にし、カーソルを乗せても色を変えない', async () => {
    render(<TranscriptionList selectedId="t1" onSelect={vi.fn()} loading={false} />);
    await screen.findByText('a.mp3');

    const item = itemButton('a.mp3');
    expect(item).toHaveClass('border-green-500', 'bg-green-50');
    expect(classesOf(item).filter((c) => c.startsWith('hover:') || c === 'border-gray-200' || c === 'bg-white')).toEqual([]);
  });

  it('削除ボタンは、ふだんは見えず、項目にカーソルを乗せたときとフォーカスしたときに見える', async () => {
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    const deleteButton = await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' });
    expect(deleteButton).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100');
    expect(deleteButton).not.toHaveClass('opacity-100');
    // 項目と削除ボタンを入れた li に group を付け、li にカーソルを乗せたときに見えるようにする
    expect(deleteButton.parentElement?.tagName).toBe('LI');
    expect(deleteButton.parentElement).toHaveClass('group', 'relative');
  });

  it('削除ボタンは、項目の右上に重ね、項目の名前と重ならないように名前の右に余白をとる', async () => {
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    const deleteButton = await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' });
    // li の relative を基準に、項目の右上に置く（absolute がないと、ボタンが項目の下に回り込む）
    expect(deleteButton).toHaveClass('absolute', 'top-[0.4rem]', 'right-[0.4rem]');
    expect(screen.getByText('a.mp3')).toHaveClass('pr-10');
  });

  it('削除しているあいだは、削除ボタンを見えたままにする', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    vi.mocked(deleteTranscription).mockReturnValue(new Promise(() => {}));
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' }));

    const deleting = await screen.findByRole('button', { name: 'a.mp3 の文字起こしを削除' });
    await waitFor(() => expect(deleting).toHaveTextContent('削除中'));
    expect(deleting).toHaveClass('opacity-100');
    expect(deleting).not.toHaveClass('opacity-0');
    // ほかの項目の削除ボタンは、押せないまま見えない
    const other = screen.getByRole('button', { name: 'b.mp3 の文字起こしを削除' });
    expect(other).toBeDisabled();
    expect(other).toHaveClass('opacity-0', 'disabled:text-gray-400', 'disabled:border-gray-200');
  });

  it('取得に失敗したときは、赤い背景でエラーを出す', async () => {
    vi.mocked(fetchTranscriptions).mockRejectedValue(new Error('取得できませんでした'));
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    expect(await screen.findByText('取得できませんでした')).toHaveClass('bg-red-50', 'text-red-800');
  });

  it('履歴がないときは、灰色の文字で案内を出す', async () => {
    vi.mocked(fetchTranscriptions).mockResolvedValue([] as never);
    render(<TranscriptionList selectedId={null} onSelect={vi.fn()} loading={false} />);

    await waitFor(() => expect(fetchTranscriptions).toHaveBeenCalled());
    expect(screen.getByText(/文字起こし履歴がありません/)).toHaveClass('text-gray-400', 'text-center');
  });

  it('TranscriptionList.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/TranscriptionList.css');
    // 探し方がまちがっていないことを、ほかの画面の CSS が見つかることで確かめる
    expect(Object.keys(allCss)).toContain('components/SettingsPage.css');
  });

  it('ほかの CSS ファイルでも、目印のクラスに見た目を指定しない', () => {
    expect(cssFilesSelecting('transcription-list')).toEqual([]);
    // 探し方がまちがっていないことを、画面の CSS のクラスが見つかることと、src の直下の CSS も読んでいることで確かめる
    expect(cssFilesSelecting('settings-page')).toEqual(['components/SettingsPage.css']);
    expect(Object.keys(allCss)).toEqual(expect.arrayContaining(['App.css', 'index.css']));
  });
});
