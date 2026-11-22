import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuardrailMissingNotice, PrivacyPanel } from '../PrivacyPanel';
import { fetchPrivacy, scanPrivacy } from '../../api/client';
import type { PiiFinding, PrivacyStatus } from '../../types';
import { allCss } from '../../test/cssRules';

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

describe('PrivacyPanel の見た目', () => {
  const finding = (overrides: Partial<PiiFinding> = {}): PiiFinding => ({
    type: 'NAME',
    label: '氏名',
    text: '山田',
    count: 2,
    mask: false,
    needsReview: false,
    ...overrides,
  });
  const scanned = (findings: PiiFinding[]): PrivacyStatus => {
    const s = status(true);
    return { ...s, scan: { ...s.scan!, findings } };
  };
  // 取得した結果のバッジの文字が出るまで待ってから、バッジを確かめる
  const badgeOf = (text: string) => screen.findByText(text);

  it('白いカードにし、見出しの行を押すと開く', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(scanned([]));
    const { container } = render(<PrivacyPanel transcriptionId="t1" />);
    const header = await screen.findByRole('button', { expanded: false });
    expect(container.firstElementChild).toHaveClass('mb-6', 'rounded-lg', 'border', 'border-gray-200', 'bg-white');
    expect(header).toHaveClass('flex', 'w-full', 'items-center', 'gap-3', 'border-none', 'bg-transparent', 'px-4', 'py-3', 'text-left');
    expect(screen.getByText('個人情報チェック')).toHaveClass('text-base', 'font-semibold', 'text-gray-900');
  });

  it('結果のバッジは、伏せるものがなければ緑にする', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(scanned([finding()]));
    render(<PrivacyPanel transcriptionId="t1" />);
    expect(await badgeOf('1件を検出（0件を伏せて送ります）')).toHaveClass('rounded-[999px]', 'border', 'text-xs', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-800');
  });

  it('伏せるものがあれば青、要確認があれば黄色、まだ確認していなければ灰色にする（後のものを優先する）', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(scanned([finding({ mask: true })]));
    const { unmount } = render(<PrivacyPanel transcriptionId="t1" />);
    expect(await badgeOf('1件を検出（1件を伏せて送ります）')).toHaveClass('border-blue-200', 'bg-blue-50', 'text-blue-800');
    unmount();

    vi.mocked(fetchPrivacy).mockResolvedValue(scanned([finding({ mask: true }), finding({ text: '佐藤', needsReview: true })]));
    const second = render(<PrivacyPanel transcriptionId="t1" />);
    const review = await badgeOf('2件を検出（1件を伏せる・要確認1件）');
    expect(review).toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-800');
    expect(review).not.toHaveClass('bg-blue-50');
    second.unmount();

    vi.mocked(fetchPrivacy).mockResolvedValue(status(false, false));
    render(<PrivacyPanel transcriptionId="t1" />);
    expect(await badgeOf('未設定')).toHaveClass('border-gray-200', 'bg-gray-50', 'text-gray-500');
  });

  it('開くと、検出した文字列の表と、青い保存ボタンを出す', async () => {
    vi.mocked(fetchPrivacy).mockResolvedValue(scanned([finding({ needsReview: true })]));
    render(<PrivacyPanel transcriptionId="t1" />);
    await screen.findByText('1件を検出（0件を伏せる・要確認1件）');
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('table')).toHaveClass('w-full', 'border-collapse', 'text-sm');
    expect(screen.getByRole('columnheader', { name: '種類' })).toHaveClass('border-b', 'border-gray-100', 'text-left', 'font-medium', 'text-gray-500');
    expect(screen.getByRole('cell', { name: '山田' })).toHaveClass('border-b', 'border-gray-100', 'break-all');
    expect(screen.getByText('要確認')).toHaveClass('rounded-sm', 'border-amber-200', 'bg-amber-50', 'text-2xs', 'text-amber-800');
    expect(screen.getByRole('button', { name: /確認して保存/ })).toHaveClass('border-none', 'bg-primary', 'text-sm', 'text-white', 'enabled:hover:bg-primary-hover');
  });

  it('Claude に送れないことの知らせは、黄色の枠で出す', () => {
    render(<GuardrailMissingNotice />);
    expect(screen.getByText(/Claude に送れません/)).toHaveClass('my-3', 'rounded-md', 'border-amber-200', 'bg-amber-50', 'text-sm', 'text-amber-800');
  });

  it('PrivacyPanel.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/PrivacyPanel.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
