import { render, screen, waitFor } from '@testing-library/react';
import { JobProgressPage } from '../JobProgressPage';
import {
  fetchJobDetail,
  checkCredits,
} from '../../api/client';
import type { ChunkedJobDetail, CreditInfo } from '../../api/client';
import { allCss } from '../../test/cssRules';

vi.mock('../../api/client');
vi.mock('../../utils/transcription', async () => {
  const actual = await vi.importActual('../../utils/transcription');
  return {
    ...actual,
    estimateCredits: vi.fn(() => 1000),
  };
});

// 中断状態のジョブ（isProcessing: false = バックエンドで処理していない → canResume = true）
const staleJob: ChunkedJobDetail = {
  id: 'job-1',
  audioFileName: 'test-audio.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  status: 'transcribing',
  totalDurationSec: 3600,
  chunkDurationSec: 600,
  totalChunks: 6,
  currentChunkIndex: 3,
  completedChunks: [
    { index: 0, chunkFileName: 'chunk-0.mp3', startTimeSec: 0, text: 'テスト0', languageCode: 'ja' },
    { index: 1, chunkFileName: 'chunk-1.mp3', startTimeSec: 600, text: 'テスト1', languageCode: 'ja' },
    { index: 2, chunkFileName: 'chunk-2.mp3', startTimeSec: 1200, text: 'テスト2', languageCode: 'ja' },
  ],
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
  isProcessing: false,
};

// クレジット十分
const sufficientCredit: CreditInfo = {
  characterCount: 50000,
  characterLimit: 100000,
  remainingCredits: 50000,
  nextResetDate: '2024-02-01T00:00:00Z',
};

// クレジット不足（estimateCredits=1000 より少ない）
const insufficientCredit: CreditInfo = {
  characterCount: 99900,
  characterLimit: 100000,
  remainingCredits: 100,
  nextResetDate: '2024-02-01T00:00:00Z',
};

const defaultProps = {
  jobId: 'job-1',
  onBack: vi.fn(),
  onTranscriptionComplete: vi.fn(),
};

/** ジョブデータの表示を待つヘルパー */
async function waitForJobLoaded() {
  await waitFor(() => {
    expect(screen.getByText('test-audio.mp3')).toBeInTheDocument();
  });
}

describe('JobProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchJobDetail).mockResolvedValue(staleJob);
    vi.mocked(checkCredits).mockResolvedValue(sufficientCredit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('「音声を選択」ボタンが表示されない', async () => {
    render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();
    expect(screen.queryByText('音声を選択')).toBeNull();
  });

  it('クレジット取得中は「文字起こしを開始」ボタンが無効', async () => {
    // checkCredits を永遠にpendingにする
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));

    render(<JobProgressPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('文字起こしを開始')).toBeInTheDocument();
    });
    expect(screen.getByText('文字起こしを開始')).toBeDisabled();
  });

  it('クレジット取得完了後（十分）、「文字起こしを開始」ボタンが有効', async () => {
    render(<JobProgressPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('文字起こしを開始')).toBeEnabled();
    });
  });

  it('クレジット不足時にボタンが無効化され、警告メッセージが表示される', async () => {
    vi.mocked(checkCredits).mockResolvedValue(insufficientCredit);

    render(<JobProgressPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('文字起こしを開始')).toBeDisabled();
    });
    expect(screen.getByText(/クレジットが不足しています/)).toBeInTheDocument();
  });

  it('中断状態（isProcessing: false）のジョブではタイマーが停止している', async () => {
    render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();
    // isProcessing: false → isTimerRunning は false のまま → タイマー表示なし
    expect(screen.queryByText(/\d+:\d+ 経過/)).toBeNull();
  });

  it('スクロールしても、戻るボタンとタイトルは固定し、ジョブの中身だけをスクロールする', async () => {
    const { container } = render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();

    const fixed = container.querySelector('.page-layout-fixed');
    const scroll = container.querySelector('.page-layout-scroll');
    expect(fixed).toContainElement(screen.getByRole('button', { name: '← 戻る' }));
    expect(fixed).toContainElement(screen.getByRole('heading', { name: '文字起こし処理中' }));
    expect(scroll).toContainElement(screen.getByText('test-audio.mp3'));
  });
});

describe('JobProgressPage の見た目', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchJobDetail).mockResolvedValue(staleJob);
    vi.mocked(checkCredits).mockResolvedValue(sufficientCredit);
  });

  it('画面の背景は薄い灰色にし、ヘッダーは紺にする', async () => {
    const { container } = render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
    expect(back).toHaveClass('rounded-md', 'border-white/30', 'bg-transparent', 'text-md', 'text-white', 'hover:bg-white/10');
  });

  it('状態は白いカードにし、進み具合を青い帯で出す', async () => {
    render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();
    const name = screen.getByText('test-audio.mp3');
    expect(name).toHaveClass('text-base-plus', 'font-semibold', 'break-all', 'text-gray-800');
    expect(name.parentElement?.parentElement).toHaveClass('mb-6', 'rounded-[10px]', 'border', 'border-gray-200', 'bg-white', 'p-6');
    const count = screen.getByText(/完了: 3\/6 チャンク/);
    expect(count).toHaveClass('text-sm', 'text-gray-400');
    expect(count.previousElementSibling).toHaveClass('mb-2', 'h-2', 'w-full', 'overflow-hidden', 'rounded-sm', 'bg-gray-200');
    expect(count.previousElementSibling?.firstElementChild).toHaveClass('h-full', 'rounded-sm', 'bg-primary');
  });

  it('クレジットが足りれば緑、足りなければ赤の枠にし、再開のボタンは橙にする', async () => {
    const { unmount } = render(<JobProgressPage {...defaultProps} />);
    const remaining = await screen.findByText('残りクレジット');
    expect(remaining.parentElement).toHaveClass('flex', 'justify-between', 'text-md', 'text-gray-700');
    expect(remaining.parentElement?.parentElement).toHaveClass('rounded-md', 'border', 'border-green-200', 'bg-green-50');
    expect(screen.getByRole('button', { name: '文字起こしを開始' })).toHaveClass(
      'rounded-md',
      'border-none',
      'bg-amber-500',
      'text-base',
      'font-semibold',
      'text-white',
      'enabled:hover:bg-amber-600',
      'disabled:bg-gray-400',
    );
    unmount();

    vi.mocked(checkCredits).mockResolvedValue(insufficientCredit);
    render(<JobProgressPage {...defaultProps} />);
    const warning = await screen.findByText(/クレジットが不足しています/);
    expect(warning).toHaveClass('mt-2', 'text-sm', 'text-red-800');
    expect(warning.parentElement).toHaveClass('border-red-200', 'bg-red-50');
  });

  it('途中経過のテキストは、灰色の見出しの付いたカードにし、長い本文はカードの中でスクロールする', async () => {
    render(<JobProgressPage {...defaultProps} />);
    await waitForJobLoaded();
    expect(screen.getByRole('heading', { name: '途中経過テキスト' })).toHaveClass('mb-4', 'text-lg', 'font-semibold', 'text-gray-800');
    const body = screen.getByText('テスト0');
    expect(body).toHaveClass('max-h-[200px]', 'overflow-y-auto', 'px-4', 'py-3', 'text-md', 'leading-[1.7]', 'whitespace-pre-wrap', 'text-gray-700');
    expect(body.previousElementSibling).toHaveClass('flex', 'items-center', 'justify-between', 'border-b', 'border-gray-200', 'bg-gray-100');
    expect(body.parentElement).toHaveClass('overflow-hidden', 'rounded-lg', 'border', 'border-gray-200');
    expect(screen.getAllByRole('button', { name: '▶ 再生' })[0]).toHaveClass(
      'rounded-sm',
      'border-gray-300',
      'bg-white',
      'text-xs',
      'text-gray-700',
      'hover:border-blue-300',
      'hover:bg-blue-50',
      'hover:text-blue-700',
    );
  });

  it('処理中のチャンクは、青い点線の枠にし、読み込み中の丸を回す', async () => {
    vi.mocked(fetchJobDetail).mockResolvedValue({ ...staleJob, isProcessing: true });
    render(<JobProgressPage {...defaultProps} />);
    // 状態の文にも同じ言葉が出るため、チャンクの本文（div）を探す
    const placeholder = await screen.findByText('文字起こし中...', { selector: 'div' });
    expect(placeholder).toHaveClass('flex', 'items-center', 'gap-2', 'text-gray-400');
    expect(placeholder.parentElement).toHaveClass('rounded-lg', 'border', 'border-dashed', 'border-blue-300');
    expect(placeholder.parentElement).not.toHaveClass('border-gray-200');
    expect(placeholder.firstElementChild).toHaveClass('animate-spin-fast', 'rounded-full', 'border-t-primary');
  });

  it('JobProgressPage.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/JobProgressPage.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
