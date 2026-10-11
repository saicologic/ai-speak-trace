import { renderHook, waitFor } from '@testing-library/react';
import { useGuardrailConfigured } from './usePrivacyStatuses';
import { fetchPrivacy } from '../api/client';
import type { PiiFinding, PrivacyStatus } from '../types';

vi.mock('../api/client');

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
