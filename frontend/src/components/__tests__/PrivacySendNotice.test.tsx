import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { PrivacySendNotice } from '../PrivacyPanel';
import { useGuardrailConfigured } from '../../hooks/usePrivacyStatuses';
import { fetchPrivacy } from '../../api/client';
import type { PiiFinding, PrivacyStatus } from '../../types';

vi.mock('../../api/client');

const finding = (mask: boolean, needsReview: boolean): PiiFinding => ({
  type: 'NAME',
  label: '氏名',
  text: '山田',
  count: 1,
  mask,
  needsReview,
});

const status = (scanFindings: PiiFinding[] | null, configured = true): PrivacyStatus =>
  ({
    configured,
    scanning: false,
    scan: scanFindings && {
      transcriptionId: 't1',
      scannedAt: '2026-01-01T00:00:00.000Z',
      guardrailId: 'gr',
      guardrailVersion: 'DRAFT',
      findings: scanFindings,
    },
  }) as PrivacyStatus;

describe('PrivacySendNotice', () => {
  it('伏せずに送るものがなければ、何も表示しない', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status([finding(true, false), finding(false, false)]));
    const { container } = render(<PrivacySendNotice transcriptionIds={['t1']} />);
    await waitFor(() => expect(fetchPrivacy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('チェックしていない会話は、氏名・住所などが伏せずに送られることを1行で知らせる', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(null));
    render(<PrivacySendNotice transcriptionIds={['t1']} />);
    expect(
      await screen.findByText(/この会話は個人情報チェックをしていないため、氏名・住所などは伏せずに送られます/),
    ).toBeInTheDocument();
  });

  it('要確認のまま伏せない文字列があれば知らせる', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status([finding(false, true), finding(false, true)]));
    render(<PrivacySendNotice transcriptionIds={['t1']} />);
    expect(await screen.findByText(/要確認の2件（氏名など）は伏せずに送られます/)).toBeInTheDocument();
  });

  it('個人情報チェックが設定されていなければ知らせる', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(null, false));
    render(<PrivacySendNotice transcriptionIds={['t1']} />);
    expect(await screen.findByText(/Guardrail ID）が設定されていないため、Claude に送れません/)).toBeInTheDocument();
  });

  it('個人情報チェックの設定を解除した場合は、保存済みのチェック結果があっても知らせる', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status([finding(true, false)], false));
    render(<PrivacySendNotice transcriptionIds={['t1']} />);
    expect(await screen.findByText(/Guardrail ID）が設定されていないため、Claude に送れません/)).toBeInTheDocument();
  });
});

describe('useGuardrailConfigured', () => {
  it('Guardrail ID が未設定なら false を返す', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(null, false));
    const { result } = renderHook(() => useGuardrailConfigured(['t1']));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('Guardrail ID が設定されていれば true を返す', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(status(null));
    const { result } = renderHook(() => useGuardrailConfigured(['t1']));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('状態を取得できなかった場合は null を返す（ボタンは止めない）', async () => {
    vi.mocked(fetchPrivacy).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useGuardrailConfigured(['t1']));
    await waitFor(() => expect(fetchPrivacy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });
});
