import { fireEvent, render, screen } from '@testing-library/react';
import { ResumableJobsPage } from '../ResumableJobsPage';
import { allCss } from '../../test/cssRules';
import type { ChunkedJobDetail } from '../../api/client';

vi.mock('../../api/client');

const job = (overrides: Partial<ChunkedJobDetail>): ChunkedJobDetail => ({
  id: 'job-1',
  audioFileName: 'a.mp3',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  status: 'failed',
  totalDurationSec: 1200,
  chunkDurationSec: 600,
  totalChunks: 2,
  currentChunkIndex: 1,
  completedChunks: [],
  ...overrides,
});

const jobs = [
  job({ id: 'j1', audioFileName: 'failed.mp3', status: 'failed' }),
  job({ id: 'j2', audioFileName: 'stopped.mp3', status: 'transcribing', isProcessing: false }),
  job({ id: 'j3', audioFileName: 'running.mp3', status: 'transcribing', isProcessing: true }),
  job({ id: 'j4', audioFileName: 'done.mp3', status: 'completed' }),
];

const renderPage = (list = jobs) =>
  render(<ResumableJobsPage jobs={list} onBack={() => {}} onSelectJob={() => {}} onJobsDeleted={() => {}} />);

describe('ResumableJobsPage の見た目', () => {
  it('画面の背景は薄い灰色にし、ヘッダーは紺にする', () => {
    const { container } = renderPage();
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
    expect(back).toHaveClass('rounded-md', 'border-white/30', 'bg-transparent', 'text-md', 'text-white', 'hover:bg-white/10');
  });

  it('ジョブは白いカードにし、カーソルを乗せると青い枠と影を付ける', () => {
    renderPage();
    const card = screen.getByText('failed.mp3').closest('button');
    expect(card).toHaveClass(
      'flex',
      'w-full',
      'flex-col',
      'gap-2',
      'rounded-lg',
      'border',
      'border-gray-200',
      'bg-white',
      'text-left',
      'hover:border-primary',
      'hover:shadow-[0_1px_4px]',
      'hover:shadow-blue-500/15',
    );
    expect(screen.getByText('failed.mp3')).toHaveClass('truncate', 'text-base-plus', 'font-semibold', 'text-gray-900');
  });

  it('状態のバッジは、失敗は赤、中断は橙、処理中は青、完了は緑にする', () => {
    renderPage();
    expect(screen.getByText('失敗')).toHaveClass('rounded-sm', 'text-xs', 'font-semibold', 'bg-red-50', 'text-red-600');
    expect(screen.getByText('中断')).toHaveClass('bg-amber-50', 'text-amber-600');
    expect(screen.getByText('処理中')).toHaveClass('bg-blue-50', 'text-blue-600');
    expect(screen.getByText('完了')).toHaveClass('bg-green-50', 'text-green-600');
  });

  it('ジョブを選ぶと、赤い削除のボタンを出す', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('button', { name: '1件を削除' })).toHaveClass(
      'rounded-md',
      'border-none',
      'bg-danger',
      'text-md',
      'font-semibold',
      'text-white',
      'enabled:hover:bg-danger-hover',
      'disabled:bg-gray-400',
    );
  });

  it('ジョブがないときは、灰色の文字で案内を出す', () => {
    renderPage([]);
    expect(screen.getByText('進行中のジョブはありません').parentElement).toHaveClass('py-12', 'text-center', 'text-base-plus', 'text-gray-500');
  });

  it('ResumableJobsPage.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/ResumableJobsPage.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
