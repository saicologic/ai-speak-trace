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
import { allCss } from '../../test/cssRules';

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

  it('スクロールしても、戻るボタンとタイトルは固定し、ファイルの選択から下だけをスクロールする', () => {
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));
    const { container } = render(<TranscribePage {...defaultProps} />);

    const fixed = container.querySelector('.page-layout-fixed');
    const scroll = container.querySelector('.page-layout-scroll');
    expect(fixed).toContainElement(screen.getByRole('button', { name: '← 戻る' }));
    expect(fixed).toContainElement(screen.getByRole('heading', { name: '音声ファイルの文字起こし' }));
    expect(scroll).toContainElement(screen.getByRole('heading', { name: '音声ファイルを選択' }));
  });
});

describe('TranscribePage の見た目', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAudioFileExists).mockResolvedValue(false);
    // ほかのテストでブラウザに切り替えたままにしないよう、デスクトップアプリ（Tauri）に戻す
    vi.mocked(isTauri).mockReturnValue(true);
  });

  it('画面の背景は薄い灰色にし、ヘッダーは紺にする', () => {
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));
    const { container } = render(<TranscribePage {...defaultProps} />);
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
    expect(back).toHaveClass('rounded-md', 'border-white/30', 'bg-transparent', 'text-md', 'text-white', 'hover:bg-white/10');
  });

  it('ファイルの選択は、白いカードの中の点線の大きいボタンにする', () => {
    vi.mocked(checkCredits).mockReturnValue(new Promise(() => {}));
    render(<TranscribePage {...defaultProps} />);
    const heading = screen.getByRole('heading', { name: '音声ファイルを選択' });
    expect(heading).toHaveClass('mb-4', 'text-lg', 'font-semibold', 'text-gray-800');
    expect(heading.parentElement).toHaveClass('rounded-[10px]', 'border', 'border-gray-200', 'bg-white', 'p-6');
    expect(screen.getByRole('button', { name: 'ファイルを選択' })).toHaveClass(
      'mb-3',
      'w-full',
      'rounded-xl',
      'border-2',
      'border-dashed',
      'border-gray-300',
      'bg-[#fafbfc]',
      'p-6',
      'text-lg',
      'hover:border-blue-300',
      'hover:bg-blue-50',
    );
  });

  it('ファイルを選ぶと、緑の枠でファイル名とクレジットを出し、同意の確認と実行のボタンを出す', async () => {
    vi.mocked(checkCredits).mockResolvedValue(sufficientCredit);
    await goToPreviewStep();
    expect(screen.getByText('test.mp3').parentElement).toHaveClass('flex', 'items-center', 'gap-2', 'rounded-lg', 'border-green-200', 'bg-green-50');
    const credit = await screen.findByText('残りクレジット');
    expect(credit.parentElement).toHaveClass('flex', 'justify-between', 'text-gray-700');
    expect(credit.parentElement?.parentElement).toHaveClass('rounded-lg', 'border-green-200', 'bg-green-50', 'text-md');
    expect(screen.getByRole('checkbox', { name: /同意を得ています/ }).parentElement).toHaveClass(
      'flex',
      'cursor-pointer',
      'items-start',
      'rounded-lg',
      'border-gray-200',
      'bg-gray-50',
      'text-md',
    );
    expect(screen.getByRole('button', { name: '文字起こしを実行' })).toHaveClass(
      'w-full',
      'rounded-lg',
      'border-none',
      'bg-primary',
      'p-3',
      'text-lg',
      'font-semibold',
      'text-white',
      'enabled:hover:bg-primary-hover',
      'disabled:bg-gray-400',
    );
  });

  it('TranscribePage.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/TranscribePage.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
