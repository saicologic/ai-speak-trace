import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import {
  fetchGroundingTier,
  fetchSettings,
  switchGroundingToStandard,
  updateSettings,
} from '../../api/client';
import { confirmDialog } from '../../utils/platform';
import type { AppSettings } from '../../types';

vi.mock('../../api/client');
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  confirmDialog: vi.fn(),
}));

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
    vi.mocked(fetchGroundingTier).mockReset().mockResolvedValue({ tier: 'STANDARD' });
    vi.mocked(switchGroundingToStandard).mockReset();
    vi.mocked(confirmDialog).mockReset().mockResolvedValue(true);
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

  describe('根拠の確認の tier', () => {
    it.each([
      ['STANDARD', '根拠の確認: Standard（日本語の文も確かめます）'],
      ['CLASSIC', '根拠の確認: Classic（日本語の文は確かめません）'],
      ['NONE', '根拠の確認: 設定されていません'],
      ['UNKNOWN', '根拠の確認: 確かめられませんでした'],
    ] as const)('%s のとき、tier を表示する', async (tier, text) => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier });
      render(<SettingsPage onBack={vi.fn()} />);
      expect(await screen.findByText(new RegExp(text.replace(/[()（）]/g, '.')))).toBeInTheDocument();
    });

    it.each(['STANDARD', 'NONE', 'UNKNOWN'] as const)(
      '%s のときは「Standard に切り替える」ボタンを出さない',
      async (tier) => {
        vi.mocked(fetchGroundingTier).mockResolvedValue({ tier });
        render(<SettingsPage onBack={vi.fn()} />);
        await screen.findByText(/根拠の確認: /);
        expect(
          screen.queryByRole('button', { name: 'Standard に切り替える' }),
        ).not.toBeInTheDocument();
      },
    );

    it('確かめの画面で OK を押すと切り替え、tier と新しいバージョンを表示する', async () => {
      // 切り替えた後に読み直すと、バックエンドは新しいバージョンの STANDARD を返す
      vi.mocked(fetchGroundingTier)
        .mockResolvedValueOnce({ tier: 'CLASSIC' })
        .mockResolvedValue({ tier: 'STANDARD' });
      vi.mocked(switchGroundingToStandard).mockResolvedValue({
        tier: 'STANDARD',
        version: '4',
        settings: settings({ guardrail: { id: 'gr-1', version: '4' } }),
      });
      render(<SettingsPage onBack={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole('button', { name: 'Standard に切り替える' }),
      );

      expect(await screen.findByText(/根拠の確認: Standard/)).toBeInTheDocument();
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.stringContaining('AWS の Guardrail の設定を書き換えます'),
        expect.anything(),
      );
      expect(screen.getByPlaceholderText('DRAFT')).toHaveValue('4');
      // 新しいバージョンの tier を読み直した後も Standard のままで、ボタンは消える
      await waitFor(() => expect(fetchGroundingTier).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/根拠の確認: Standard/)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Standard に切り替える' }),
      ).not.toBeInTheDocument();
    });

    it('確かめの画面で取り消すと、切り替えない', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      vi.mocked(confirmDialog).mockResolvedValue(false);
      render(<SettingsPage onBack={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole('button', { name: 'Standard に切り替える' }),
      );

      await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
      expect(switchGroundingToStandard).not.toHaveBeenCalled();
    });

    it('切り替えに失敗したら、理由を表示する', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      vi.mocked(switchGroundingToStandard).mockRejectedValue(
        new Error('根拠の確認を Standard tier にできませんでした: DRAFT の設定が違う'),
      );
      render(<SettingsPage onBack={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole('button', { name: 'Standard に切り替える' }),
      );

      expect(await screen.findByText(/DRAFT の設定が違う/)).toBeInTheDocument();
    });

    it('保存していない入力があるときは切り替えられず、先に保存するよう案内する', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      render(<SettingsPage onBack={vi.fn()} />);
      const button = await screen.findByRole('button', {
        name: 'Standard に切り替える',
      });
      expect(button).toBeEnabled();

      fireEvent.change(screen.getByPlaceholderText('DRAFT'), {
        target: { value: '7' },
      });

      expect(button).toBeDisabled();
      expect(
        screen.getByText(/保存していない変更があります。先に保存してから切り替えてください/),
      ).toBeInTheDocument();
    });

    it('切り替えている間は、入力も保存もできない（切り替えた後の設定で、入力が上書きされるため）', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      vi.mocked(switchGroundingToStandard).mockReturnValue(new Promise(() => {}));
      render(<SettingsPage onBack={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole('button', { name: 'Standard に切り替える' }),
      );
      await waitFor(() => expect(switchGroundingToStandard).toHaveBeenCalled());

      expect(screen.getByPlaceholderText('DRAFT')).toBeDisabled();
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    });

    it('確かめの画面を出している間から、入力と切り替えのボタンを使えなくする（別の Guardrail を切り替えないため）', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      vi.mocked(confirmDialog).mockReturnValue(new Promise(() => {}));
      render(<SettingsPage onBack={vi.fn()} />);

      const button = await screen.findByRole('button', {
        name: 'Standard に切り替える',
      });
      fireEvent.click(button);
      await waitFor(() => expect(confirmDialog).toHaveBeenCalled());

      expect(screen.getByPlaceholderText('DRAFT')).toBeDisabled();
      expect(button).toBeDisabled();
    });

    it('確かめの画面で取り消したら、入力できる状態に戻す', async () => {
      vi.mocked(fetchGroundingTier).mockResolvedValue({ tier: 'CLASSIC' });
      vi.mocked(confirmDialog).mockResolvedValue(false);
      render(<SettingsPage onBack={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole('button', { name: 'Standard に切り替える' }),
      );

      await waitFor(() =>
        expect(screen.getByPlaceholderText('DRAFT')).toBeEnabled(),
      );
    });

    it('AI 分析が OFF なら、tier を読まない', async () => {
      vi.mocked(fetchSettings).mockResolvedValue(settings({ enableAiAnalysis: false }));
      render(<SettingsPage onBack={vi.fn()} />);
      await screen.findByRole('checkbox', { name: 'AI 分析を使う' });
      expect(fetchGroundingTier).not.toHaveBeenCalled();
    });

    it('Guardrail ID がなければ、tier を読まない', async () => {
      vi.mocked(fetchSettings).mockResolvedValue(
        settings({ guardrail: { id: '', version: '' } }),
      );
      render(<SettingsPage onBack={vi.fn()} />);
      await screen.findByRole('heading', { name: 'AI 分析（Claude と AWS）' });
      expect(fetchGroundingTier).not.toHaveBeenCalled();
    });
  });
});
