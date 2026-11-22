import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackButton } from '../FeedbackButton';
import { allCss } from '../../test/cssRules';
import { fetchFeedback, submitFeedback } from '../../api/client';
import type { Feedback } from '../../types';

vi.mock('../../api/client');

const report = (overrides: Partial<Feedback> = {}): Feedback => ({
  id: 'f1',
  createdAt: '2026-10-11T00:00:00.000Z',
  feature: 'summary',
  targetId: 'log-1',
  transcriptionId: 't1',
  category: 'unsupported',
  quote: '会話にない内容',
  comment: '',
  ...overrides,
});

describe('FeedbackButton', () => {
  beforeEach(() => {
    vi.mocked(fetchFeedback).mockReset().mockResolvedValue([]);
    vi.mocked(submitFeedback).mockReset();
  });

  it('これまでに報告した誤りを表示する', async () => {
    vi.mocked(fetchFeedback).mockResolvedValue([report()]);
    render(<FeedbackButton feature="summary" targetId="log-1" transcriptionId="t1" />);
    expect(await screen.findByText('報告した誤り（1件）')).toBeInTheDocument();
    expect(screen.getByText('元の会話・出典にない内容')).toBeInTheDocument();
    expect(fetchFeedback).toHaveBeenCalledWith('summary', 'log-1');
  });

  it('種類・箇所・コメントを報告し、報告した誤りに加える', async () => {
    vi.mocked(submitFeedback).mockResolvedValue(
      report({ category: 'personal_judgement', quote: '性格の推測', comment: '個人の評価' }),
    );
    render(<FeedbackButton feature="summary" targetId="log-1" transcriptionId="t1" />);

    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal_judgement' } });
    fireEvent.change(screen.getByLabelText('誤りだと思った箇所（任意）'), {
      target: { value: '性格の推測' },
    });
    fireEvent.change(screen.getByLabelText('コメント（任意）'), { target: { value: '個人の評価' } });
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        feature: 'summary',
        targetId: 'log-1',
        transcriptionId: 't1',
        category: 'personal_judgement',
        quote: '性格の推測',
        comment: '個人の評価',
      }),
    );
    expect(await screen.findByText('報告した誤り（1件）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '誤りを報告' })).toBeInTheDocument();
  });

  it('「その他」は、内容を書くまで報告できない', () => {
    render(<FeedbackButton feature="context" targetId="" transcriptionId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: '報告する' })).toBeDisabled();
    // 保存しない結果（発言の文脈）は、報告の一覧を取りに行かない
    expect(fetchFeedback).not.toHaveBeenCalled();
  });

  it('保存に失敗したら、エラーを表示してフォームを残す', async () => {
    vi.mocked(submitFeedback).mockRejectedValue(new Error('文字起こし結果が見つかりません'));
    render(<FeedbackButton feature="summary" targetId="log-1" transcriptionId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));
    expect(await screen.findByText('文字起こし結果が見つかりません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '報告する' })).toBeInTheDocument();
  });

  it('複数の会話を使った結果は、すべての会話を報告に付ける', async () => {
    vi.mocked(submitFeedback).mockResolvedValue(report({ feature: 'research', targetId: 'job-1' }));
    render(
      <FeedbackButton feature="research" targetId="job-1" transcriptionId="t1" transcriptionIds={['t1', 't2']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'research', targetId: 'job-1', transcriptionIds: ['t1', 't2'] }),
      ),
    );
  });
});

describe('FeedbackButton の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchFeedback).mockReset().mockResolvedValue([]);
  });

  it('「誤りを報告」は小さい白いボタンにし、報告した誤りは赤い枠で出す', async () => {
    vi.mocked(fetchFeedback).mockResolvedValue([report()]);
    render(<FeedbackButton feature="summary" targetId="log-1" transcriptionId="t1" />);
    const title = await screen.findByText('報告した誤り（1件）');
    expect(title).toHaveClass('mb-1', 'font-semibold');
    expect(title.parentElement).toHaveClass('mb-2', 'rounded-md', 'border-red-200', 'bg-red-50', 'text-red-900');
    expect(screen.getByText('元の会話・出典にない内容')).toHaveClass('mr-[0.4rem]', 'font-semibold');
    expect(screen.getByRole('button', { name: '誤りを報告' })).toHaveClass(
      'rounded-md',
      'border-gray-300',
      'bg-white',
      'text-xs',
      'text-gray-700',
      'hover:bg-gray-50',
    );
  });

  it('報告のフォームは灰色の枠にし、入力欄は小さい文字で、画面と同じ字体にする', () => {
    render(<FeedbackButton feature="summary" targetId="" transcriptionId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    const hint = screen.getByText(/報告はこの Mac にだけ保存し/);
    expect(hint).toHaveClass('mb-2', 'text-xs', 'text-gray-500');
    expect(hint.parentElement).toHaveClass('rounded-md', 'border-gray-200', 'bg-gray-50', 'p-3');
    for (const field of [screen.getByRole('combobox'), screen.getAllByRole('textbox')[0], screen.getAllByRole('textbox')[1]]) {
      expect(field).toHaveClass('rounded-sm', 'border-gray-300', 'text-sm', '[font-family:inherit]');
    }
  });

  it('「報告する」は青く、「キャンセル」は白くする', () => {
    render(<FeedbackButton feature="summary" targetId="" transcriptionId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    expect(screen.getByRole('button', { name: '報告する' })).toHaveClass('border-blue-600', 'bg-blue-600', 'text-white');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveClass('border-gray-300', 'bg-white', 'disabled:opacity-50');
  });

  it('FeedbackButton.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/FeedbackButton.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
