import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import { fetchSettings, updateSettings } from '../../api/client';
import type { AppSettings } from '../../types';
import { allCss } from '../../test/cssRules';

vi.mock('../../api/client');

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  appVersion: '0.1.0',
  paths: {
    dataDir: '/data',
    audioDir: '/data/audio',
    transcriptionsDir: '/data/transcriptions',
    summaryLogsDir: '/data/summary-logs',
  },
  apiKeys: {
    elevenlabsApiKey: { configured: false, last4: '' },
    anthropicApiKey: { configured: true, last4: '1234' },
  },
  apiKeyStorage: 'keychain',
  enableAiAnalysis: true,
  guardrail: { id: 'gr-1', version: '' },
  ...overrides,
});

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(fetchSettings).mockReset().mockResolvedValue(settings());
    vi.mocked(updateSettings)
      .mockReset()
      .mockResolvedValue({ settings: settings(), restartRequired: false });
  });

  it('保存済みの API キーは、値を入力欄に出さず、状態と末尾4文字だけを表示する', async () => {
    render(<SettingsPage onBack={vi.fn()} />);

    expect(await screen.findByText('設定済み（末尾 1234）')).toBeInTheDocument();
    expect(screen.getByText('未設定')).toBeInTheDocument();
    expect(screen.getByText(/キーチェーンに保存します/)).toBeInTheDocument();
    for (const input of screen.getAllByPlaceholderText(/キー/)) {
      expect(input).toHaveValue('');
    }
  });

  it('AI 分析は、Anthropic の API キーと Guardrail ID がそろっていれば「使えます」と表示する', async () => {
    render(<SettingsPage onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'AI 分析（Claude と AWS）' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'AI 分析を使う' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('使えます');
  });

  it('AI 分析が OFF の場合は、Claude と AWS の設定を出さず、ON にすると出す', async () => {
    vi.mocked(fetchSettings).mockResolvedValue(settings({ enableAiAnalysis: false }));
    render(<SettingsPage onBack={vi.fn()} />);

    const toggle = await screen.findByRole('checkbox', { name: 'AI 分析を使う' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByPlaceholderText('DRAFT')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByPlaceholderText('DRAFT')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('保存すると使えます');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ enableAiAnalysis: true }),
    );
  });

  it('AI 分析に足りない設定を表示する', async () => {
    vi.mocked(fetchSettings).mockResolvedValue(
      settings({
        apiKeys: {
          elevenlabsApiKey: { configured: true, last4: '' },
          anthropicApiKey: { configured: false, last4: '' },
        },
        guardrail: { id: '', version: '' },
      }),
    );
    render(<SettingsPage onBack={vi.fn()} />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      '未設定: Anthropic の API キー・Guardrail ID',
    );
  });

  it('入力した API キーだけを保存する', async () => {
    render(<SettingsPage onBack={vi.fn()} />);
    const input = await screen.findByPlaceholderText('変更する場合だけ、新しいキーを入力');

    fireEvent.change(input, { target: { value: ' new-value ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ anthropicApiKey: 'new-value' }),
    );
  });

  it('「削除」を押して保存すると、API キーを削除する', async () => {
    render(<SettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '削除' }));
    expect(screen.getByText('保存すると削除します')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ anthropicApiKey: '' }),
    );
  });

  it('Guardrail のバージョンを保存する', async () => {
    render(<SettingsPage onBack={vi.fn()} />);

    fireEvent.change(await screen.findByPlaceholderText('DRAFT'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ bedrockGuardrailVersion: '2' }),
    );
  });

  it('保存に失敗した理由（存在しないバージョンなど）を表示する', async () => {
    vi.mocked(updateSettings).mockRejectedValue(
      new Error('Guardrail（ID: gr-1、バージョン: 99）を確認できなかったため、保存しませんでした'),
    );
    render(<SettingsPage onBack={vi.fn()} />);

    fireEvent.change(await screen.findByPlaceholderText('DRAFT'), {
      target: { value: '99' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText(/確認できなかったため、保存しませんでした/)).toBeInTheDocument();
  });

  it('キーチェーンを使えない環境では、暗号化せずに保存することを知らせる', async () => {
    vi.mocked(fetchSettings).mockResolvedValue(settings({ apiKeyStorage: 'file' }));
    render(<SettingsPage onBack={vi.fn()} />);

    expect(await screen.findByText(/暗号化せずに保存します/)).toBeInTheDocument();
  });

  it('スクロールしても、戻るボタンとタイトルは固定し、設定の中身だけをスクロールする', async () => {
    const { container } = render(<SettingsPage onBack={vi.fn()} />);

    const fixed = container.querySelector('.page-layout-fixed');
    const scroll = container.querySelector('.page-layout-scroll');
    expect(fixed).toContainElement(screen.getByRole('button', { name: '← 戻る' }));
    expect(fixed).toContainElement(screen.getByRole('heading', { name: '設定', level: 1 }));
    expect(scroll).toContainElement(await screen.findByText('設定済み（末尾 1234）'));
  });
});

describe('SettingsPage の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchSettings).mockReset().mockResolvedValue(settings());
  });

  it('画面の背景は薄い灰色にし、ヘッダーは紺にする', async () => {
    const { container } = render(<SettingsPage onBack={vi.fn()} />);
    await screen.findByText('設定済み（末尾 1234）');
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
    expect(back).toHaveClass('rounded-md', 'border-white/30', 'bg-transparent', 'text-md', 'text-white', 'hover:bg-white/10');
    expect(screen.getByRole('heading', { name: '設定', level: 1 })).toHaveClass('text-xl', 'font-semibold');
  });

  it('設定は白いカードに分け、見出しの下に線を引く（ボタンと並べる見出しは線を引かない）', async () => {
    render(<SettingsPage onBack={vi.fn()} />);
    const heading = await screen.findByRole('heading', { name: '文字起こし' });
    expect(heading).toHaveClass('mb-4', 'border-b', 'border-gray-100', 'pb-3', 'text-lg', 'font-semibold', 'text-gray-800');
    expect(heading.parentElement).toHaveClass('mb-6', 'rounded-[10px]', 'border', 'border-gray-200', 'bg-white', 'p-6');
    const folder = screen.getByRole('heading', { name: 'データ保存先' });
    expect(folder).toHaveClass('text-lg', 'font-semibold', 'text-gray-800');
    expect(folder).not.toHaveClass('border-b', 'mb-4');
  });

  it('AI 分析の状態は、使えるときは緑、足りない設定があるときは黄色にする', async () => {
    const { unmount } = render(<SettingsPage onBack={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveClass('rounded-lg', 'text-md', 'font-semibold', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
    unmount();
    vi.mocked(fetchSettings).mockResolvedValue(settings({ guardrail: { id: '', version: '' } }));
    render(<SettingsPage onBack={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-800');
  });

  it('API キーの入力欄は、表示ボタンの分だけ右をあけ、表示ボタンは入力欄の右に重ねる', async () => {
    render(<SettingsPage onBack={vi.fn()} />);
    const input = (await screen.findAllByPlaceholderText('変更する場合だけ、新しいキーを入力'))[0];
    expect(input).toHaveClass('w-full', 'rounded-lg', 'border-gray-200', 'px-3', 'py-2', 'pr-14', 'text-md', 'focus:border-primary');
    fireEvent.change(input, { target: { value: 'sk-test' } });
    expect(screen.getByRole('button', { name: '表示' })).toHaveClass('absolute', 'right-2', 'top-1/2', '-translate-y-1/2', 'border-primary', 'text-primary', 'hover:bg-primary', 'hover:text-white');
  });

  it('「保存」ボタンは青くし、押せないときは薄くする', async () => {
    render(<SettingsPage onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '保存' })).toHaveClass(
      'rounded-lg',
      'border-none',
      'bg-primary',
      'px-6',
      'py-[0.6rem]',
      'text-base',
      'text-white',
      'enabled:hover:bg-primary-hover',
      'disabled:opacity-50',
    );
  });

  it('SettingsPage.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/SettingsPage.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
