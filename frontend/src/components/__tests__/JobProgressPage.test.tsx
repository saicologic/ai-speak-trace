import { render, screen, waitFor } from '@testing-library/react';
import { JobProgressPage } from '../JobProgressPage';
import {
  fetchJobDetail,
  checkCredits,
} from '../../api/client';
import type { ChunkedJobDetail, CreditInfo } from '../../api/client';

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
});
