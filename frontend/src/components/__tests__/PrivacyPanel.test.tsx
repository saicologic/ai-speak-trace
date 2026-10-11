import { render, screen, waitFor } from '@testing-library/react';
import { GuardrailMissingNotice, PrivacyPanel } from '../PrivacyPanel';
import { fetchPrivacy, scanPrivacy } from '../../api/client';
import type { PrivacyStatus } from '../../types';

vi.mock('../../api/client');

const status = (scanned: boolean, configured = true): PrivacyStatus =>
  ({
    configured,
    scanning: false,
    scan: scanned
      ? {
          transcriptionId: 't1',
          scannedAt: '2026-01-01T00:00:00.000Z',
          guardrailId: 'gr',
          guardrailVersion: 'DRAFT',
          findings: [],
        }
      : null,
  }) as PrivacyStatus;

describe('PrivacyPanel', () => {
  beforeEach(() => {
    vi.mocked(scanPrivacy).mockReset();
    vi.mocked(scanPrivacy).mockResolvedValue(status(true));
  });

  it('まだ確認していない会話は、自動で検出する', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(false));
    render(<PrivacyPanel transcriptionId="t1" title="前編.mp3" />);
    await waitFor(() => expect(scanPrivacy).toHaveBeenCalledWith('t1'));
    expect(scanPrivacy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('個人情報チェック: 前編.mp3')).toBeInTheDocument();
  });

  it('確認済みの会話は、検出し直さない', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(true));
    render(<PrivacyPanel transcriptionId="t1" />);
    await waitFor(() => expect(fetchPrivacy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanPrivacy).not.toHaveBeenCalled();
  });

  it('Guardrail ID が未設定なら、検出しない', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(false, false));
    render(<PrivacyPanel transcriptionId="t1" />);
    await waitFor(() => expect(fetchPrivacy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanPrivacy).not.toHaveBeenCalled();
  });
});

describe('GuardrailMissingNotice', () => {
  it('Claude に送れないことを知らせる', () => {
    render(<GuardrailMissingNotice />);
    expect(screen.getByText(/Guardrail ID）が設定されていないため、Claude に送れません/)).toBeInTheDocument();
  });
});
