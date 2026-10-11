import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TranscriptionList } from '../TranscriptionList';
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
