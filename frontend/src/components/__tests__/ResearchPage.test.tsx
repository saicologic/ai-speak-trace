import { fireEvent, render, screen } from '@testing-library/react';
import { ResearchPage } from '../ResearchPage';
import { fetchPrivacy, fetchResearchJobs, fetchTranscriptions } from '../../api/client';
import { allCss, cssFilesSelecting } from '../../test/cssRules';
import type { PrivacyStatus } from '../../types';

vi.mock('../../api/client');

const renderPage = () => render(<ResearchPage onBack={vi.fn()} onOpenTranscription={vi.fn()} />);

describe('ResearchPage の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchTranscriptions).mockResolvedValue([
      { id: 't1', audioFileName: '前編.mp3', createdAt: '2026-11-01T00:00:00.000Z' },
    ]);
    vi.mocked(fetchResearchJobs).mockResolvedValue([]);
    vi.mocked(fetchPrivacy).mockResolvedValue({ configured: true, scanning: false, scan: null } as PrivacyStatus);
  });

  it('ヘッダーは紺にし、タイトルは残りの幅を使う', async () => {
    const { container } = renderPage();
    await screen.findByText('前編.mp3');
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const title = screen.getByRole('heading', { name: 'ディープサーチ', level: 1 });
    expect(title).toHaveClass('flex-1', 'text-xl', 'font-semibold');
    expect(title.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
  });

  it('調査の流れは 5 列に並べ（狭い画面では 1 列）、まだの段階は灰色にする', async () => {
    const { container } = renderPage();
    await screen.findByText('前編.mp3');
    // research-content は、テストでスクロールする部分の中身を探すための目印
    expect(container.querySelector('.research-content')).toHaveClass('mx-auto', 'w-full', 'max-w-[880px]', 'flex-1', 'p-8', 'max-[720px]:p-4');
    const label = screen.getByText('会話の読み込み');
    expect(label).toHaveClass('text-base', 'font-semibold');
    const step = label.parentElement;
    expect(step).toHaveClass('relative', 'flex', 'flex-col', 'rounded-lg', 'border', 'bg-white', 'border-gray-200', 'text-gray-400');
    expect(step?.parentElement).toHaveClass('mb-8', 'grid', 'list-none', 'grid-cols-5', 'gap-2', 'max-[720px]:grid-cols-1');
    expect(step?.firstElementChild).toHaveClass('inline-flex', 'size-6', 'rounded-full', 'bg-gray-200', 'text-gray-500');
  });

  it('会話の選び方は、見出し・説明・白い枠の一覧・注意・青いボタンの順に出す', async () => {
    renderPage();
    const name = await screen.findByText('前編.mp3');
    expect(screen.getByRole('heading', { name: '① 調べる会話を選ぶ' })).toHaveClass('mb-3', 'text-lg', 'font-semibold', 'text-gray-800');
    expect(screen.getByText(/選んだ会話の全文をもとに/)).toHaveClass('mb-3', 'text-md', 'leading-[1.6]', 'text-gray-500');
    expect(name).toHaveClass('flex-1', 'wrap-anywhere');
    expect(name.closest('ul')).toHaveClass('max-h-[320px]', 'list-none', 'overflow-y-auto', 'rounded-lg', 'border', 'border-gray-200', 'bg-white', '[&_li+li]:border-t', '[&_label]:flex');
    expect(screen.getByText(/選んだ会話の全文を Anthropic/)).toHaveClass('my-3', 'rounded-md', 'border-amber-200', 'bg-amber-50', 'text-sm', 'text-amber-800');
    expect(screen.getByRole('button', { name: /件の会話で調査を始める/ })).toHaveClass(
      'rounded-lg',
      'border-none',
      'bg-blue-600',
      'text-base',
      'font-semibold',
      'text-white',
      'disabled:bg-gray-400',
    );
  });

  it('調査結果のタブの一覧が空のときは、灰色の文字で案内を出す', async () => {
    renderPage();
    await screen.findByText('前編.mp3');
    fireEvent.click(screen.getByRole('button', { name: '調査結果' }));
    expect(await screen.findByText('調査結果がありません')).toHaveClass('text-center', 'text-sm', 'text-gray-400');
  });

  it('ResearchPage.css を残さず、目印のクラスにも見た目を指定しない', () => {
    expect(Object.keys(allCss)).not.toContain('components/ResearchPage.css');
    for (const marker of ['research-content', 'research-cite', 'research-cite-popover']) {
      expect(cssFilesSelecting(marker)).toEqual([]);
    }
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
