import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import { fetchSettings, updateSettings } from '../../api/client';
import type { AppSettings } from '../../types';

vi.mock('../../api/client');

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  appVersion: '0.1.0',
  storageType: 'local',
  paths: {
    dataDir: '/data',
    audioDir: '/data/audio',
    transcriptionsDir: '/data/transcriptions',
    documentsDir: '/data/documents',
    documentMetadataDir: '/data/document-metadata',
    summaryLogsDir: '/data/summary-logs',
  },
  apiKeys: {
    elevenlabsApiKey: { configured: false, last4: '' },
    anthropicApiKey: { configured: true, last4: '1234' },
  },
  apiKeyStorage: 'keychain',
  enableDeepSearch: false,
  enableContextAnalysis: false,
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
});
