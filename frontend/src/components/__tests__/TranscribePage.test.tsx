import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscribePage } from '../TranscribePage';
import {
  checkCredits,
  checkAudioFileExists,
  deleteAllResourcesByFileName,
} from '../../api/client';
import type { CreditInfo } from '../../api/client';
import { isTauri } from '../../utils/platform';

vi.mock('../../api/client');
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/path/to/test.mp3'),
  confirm: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2])),
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/Users/test/'),
}));
// 既定はデスクトップアプリ（Tauri）として動かす
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  isTauri: vi.fn(() => true),
}));

// クレジット十分
const sufficientCredit: CreditInfo = {
  characterCount: 50000,
  characterLimit: 100000,
  remainingCredits: 50000,
  nextResetDate: '2024-02-01T00:00:00Z',
};

const defaultProps = {
  onBack: vi.fn(),
  onTranscriptionComplete: vi.fn(),
  onNavigateSettings: vi.fn(),
};

/** ファイル選択してpreview状態に遷移するヘルパー */
async function goToPreviewStep() {
  const user = userEvent.setup();
  render(<TranscribePage {...defaultProps} />);

  // 同名ファイル存在チェックをモック（存在しない）
  vi.mocked(checkAudioFileExists).mockResolvedValue(false);

  await user.click(screen.getByText('ファイルを選択'));

  // preview状態に遷移するのを待つ
  await waitFor(() => {
    expect(screen.getByText('音声ファイルの確認')).toBeInTheDocument();
  });
}

describe('TranscribePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAudioFileExists).mockResolvedValue(false);
    vi.mocked(deleteAllResourcesByFileName).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('クレジット取得中は「文字起こしを実行」ボタンが無効', async () => {
    // checkCredits を永遠にpendingにする
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));

    await goToPreviewStep();
    expect(screen.getByText('文字起こしを実行')).toBeDisabled();
  });

  it('クレジットが十分でも、録音の同意を確認するまでは「文字起こしを実行」ボタンが無効', async () => {
    vi.mocked(checkCredits).mockResolvedValue(sufficientCredit);

    await goToPreviewStep();
    await waitFor(() => {
      expect(checkCredits).toHaveBeenCalled();
    });
    expect(screen.getByText('文字起こしを実行')).toBeDisabled();
  });

  it('クレジット取得完了後（十分）、録音の同意を確認すると「文字起こしを実行」ボタンが有効', async () => {
    vi.mocked(checkCredits).mockResolvedValue(sufficientCredit);

    await goToPreviewStep();
    await userEvent.click(screen.getByRole('checkbox', { name: /同意を得ています/ }));
    await waitFor(() => {
      expect(screen.getByText('文字起こしを実行')).toBeEnabled();
    });
  });

  it('ブラウザ（開発サーバー）では、ブラウザのファイル選択で読み込む', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { container } = render(<TranscribePage {...defaultProps} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickInput = vi.spyOn(input, 'click');

    await user.click(screen.getByText('ファイルを選択'));
    expect(clickInput).toHaveBeenCalled();

    await user.upload(input, new File([new Uint8Array([0, 1, 2])], 'test.mp3', { type: 'audio/mpeg' }));
    await waitFor(() => {
      expect(screen.getByText('音声ファイルの確認')).toBeInTheDocument();
    });
  });
});
