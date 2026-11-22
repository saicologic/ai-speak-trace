import { fireEvent, render, screen } from '@testing-library/react';
import { SummaryPage } from '../SummaryPage';
import {
  fetchFeedback,
  fetchPrivacy,
  fetchSummaryConfig,
  fetchSummaryLog,
  fetchSummaryLogs,
  summarizeTranscription,
} from '../../api/client';
import { allCss } from '../../test/cssRules';
import type { PrivacyStatus, TranscriptionSummaryLog } from '../../types';

vi.mock('../../api/client');

const log: TranscriptionSummaryLog = {
  id: 's1',
  transcriptionId: 't-1',
  overview: '概要の本文',
  key_points: [
    {
      topic: '論点その1',
      summary: '論点の要約',
      evidence: [{ quote: '根拠の引用', utteranceIndex: 0, speakerName: 'Aさん', start: 9 }],
    },
  ],
  decisions: ['決定事項その1'],
  createdAt: '2026-11-20T10:00:00.000Z',
  model: 'claude-test',
  prompt: '指示の本文',
  droppedEvidenceCount: 1,
};

const renderPage = () => render(<SummaryPage transcriptionId="t-1" onBack={vi.fn()} onOpenUtterance={vi.fn()} />);

/** 要約結果のタブで、要約を開く */
const openLog = async () => {
  fireEvent.click(screen.getByRole('button', { name: '要約結果' }));
  fireEvent.click(await screen.findByRole('button', { name: /論点その1/ }));
  return screen.findByRole('heading', { name: '概要' });
};

describe('SummaryPage の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchPrivacy).mockResolvedValue({ configured: true, scanning: false, scan: null } as PrivacyStatus);
    vi.mocked(fetchSummaryConfig).mockResolvedValue({ defaultPrompt: '', models: [{ id: 'claude-test', label: 'テスト' }] });
    vi.mocked(fetchSummaryLogs).mockResolvedValue([log]);
    vi.mocked(fetchSummaryLog).mockResolvedValue(log);
    vi.mocked(summarizeTranscription).mockResolvedValue(log);
    vi.mocked(fetchFeedback).mockResolvedValue([]);
  });

  it('モデルの選択は白い枠の選択にし、プロンプトの見出しの行は下をあけない', async () => {
    renderPage();
    expect(await screen.findByRole('combobox')).toHaveClass('min-w-[280px]', 'rounded-lg', 'border', 'border-gray-200', 'bg-white', 'text-base', 'text-gray-800', 'focus:border-primary');
    const heading = screen.getByRole('heading', { name: 'プロンプト' });
    expect(heading).toHaveClass('text-lg', 'font-semibold', 'text-gray-800');
    expect(heading).not.toHaveClass('mb-3');
    expect(heading.parentElement).toHaveClass('mb-3', 'flex', 'items-center', 'justify-between');
  });

  it('指示の欄はカードに分け、カードの直下の入力欄は左右をあけ、キーポイントの行は項目名と並べる', () => {
    renderPage();
    const overview = screen.getByText('概要');
    expect(overview).toHaveClass('block', 'border-b', 'border-gray-100', 'text-md', 'font-medium', 'text-gray-700');
    expect(overview.parentElement).toHaveClass('overflow-hidden', 'rounded-lg', 'border', 'border-gray-200', 'bg-white');
    const overviewInput = overview.nextElementSibling;
    expect(overviewInput).toHaveClass('mx-3', 'my-[0.4rem]', 'w-[calc(100%-1.5rem)]', 'rounded-md', 'border-blue-100', 'text-[0.82rem]', 'placeholder:text-gray-400', 'focus:border-primary');
    const topic = screen.getByText('topic');
    expect(topic).toHaveClass('min-w-16', 'shrink-0', 'text-xs', 'font-semibold', 'whitespace-nowrap', 'text-gray-500');
    expect(topic.parentElement).toHaveClass('flex', 'items-center', 'gap-3', 'border-b', 'border-gray-100', 'last:border-b-0');
    expect(topic.nextElementSibling).toHaveClass('w-full', 'border-blue-100');
    expect(topic.nextElementSibling).not.toHaveClass('mx-3');
  });

  it('プロンプトのプレビューは、薄い灰色の等幅の文字で、折り返して出す', () => {
    renderPage();
    expect(screen.getByText(/会議・インタビューの文字起こしを要約する/)).toHaveClass(
      'mt-2',
      'overflow-x-auto',
      'rounded-lg',
      'border',
      'border-gray-200',
      'bg-slate-50',
      'p-3',
      'text-[0.78rem]',
      'leading-[1.6]',
      '[word-break:break-word]',
      'whitespace-pre-wrap',
      'text-gray-700',
    );
  });

  it('要約が終わると、緑の枠で知らせ、結果へのリンクを出す', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '要約する' }));
    const message = await screen.findByText('✓ 要約が完了しました。');
    expect(message).toHaveClass('text-base', 'font-medium', 'text-green-700');
    expect(message.parentElement).toHaveClass('mt-5', 'flex', 'items-center', 'gap-4', 'rounded-lg', 'border', 'border-green-200', 'bg-green-50');
    expect(screen.getByRole('button', { name: '要約結果を見る →' })).toHaveClass('border-none', 'bg-transparent', 'p-0', 'text-base', 'text-blue-700', 'underline', 'hover:text-blue-800');
  });

  it('キーポイントは左に灰色の線を引き、根拠は横に並べてリンクにする', async () => {
    renderPage();
    await openLog();
    const topic = screen.getByText('論点その1', { selector: 'span' });
    expect(topic).toHaveClass('text-md', 'font-semibold', 'text-gray-900');
    const point = topic.parentElement;
    expect(point).toHaveClass('flex', 'list-none', 'flex-col', 'gap-[0.15rem]', 'border-l-3', 'border-l-gray-200', 'pl-3', 'text-base', 'leading-[1.6]', 'text-gray-700');
    expect(point?.parentElement).toHaveClass('m-0', 'flex', 'flex-col', 'gap-[0.3rem]', 'pl-5');
    const quote = screen.getByText('「根拠の引用」');
    expect(quote.parentElement).toHaveClass('flex', 'list-none', 'flex-row', 'flex-wrap', 'items-baseline', 'gap-[0.4rem]', 'text-[0.78rem]', 'leading-[1.6]', 'text-gray-700');
    expect(quote.parentElement).not.toHaveClass('border-l-3');
    expect(screen.getByRole('button', { name: 'Aさん 0:09' })).toHaveClass('border-none', 'bg-transparent', 'p-0', 'text-xs', 'text-blue-700', 'underline');
    expect(screen.getByText(/会話の中に見つからなかった根拠/)).toHaveClass('mt-2', 'text-xs', 'text-gray-400');
  });

  it('要約の詳細の下に、モデルとプロンプトを薄い灰色の枠で出す', async () => {
    renderPage();
    await openLog();
    const label = screen.getByText('プロンプト', { selector: 'span' });
    expect(label).toHaveClass('text-[0.72rem]', 'font-semibold', 'tracking-[0.05em]', 'text-gray-400', 'uppercase');
    expect(label.parentElement?.parentElement).toHaveClass('mt-6', 'flex', 'flex-col', 'gap-3', 'rounded-lg', 'border', 'border-gray-200', 'bg-slate-50', 'p-3');
    expect(screen.getByText('指示の本文')).toHaveClass('text-[0.78rem]', 'leading-[1.6]', '[word-break:break-word]', 'whitespace-pre-wrap', 'text-gray-700');
    expect(screen.getAllByText('claude-test')[0]).toHaveClass('mt-[0.2rem]', 'truncate', 'text-2xs', 'text-gray-400');
  });

  it('SummaryPage.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/SummaryPage.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
