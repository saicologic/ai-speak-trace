import { fireEvent, render, screen } from '@testing-library/react';
import { ResumableJobsPage } from '../ResumableJobsPage';
import { SummaryPage } from '../SummaryPage';
import { InterviewPage } from '../InterviewPage';
import { ResearchPage } from '../ResearchPage';
import type { ChunkedJobDetail } from '../../api/client';

/**
 * ヘッダー（とタブ）を固定し、それ以外だけをスクロールする画面のテスト
 * 見た目の確認だけなので、API は返事をしないままにする（読み込み中の画面で確かめる）
 */
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn(() => new Promise(() => {})) : value,
    ]),
  );
});

const fixedArea = (container: HTMLElement) => container.querySelector('.page-layout-fixed');
const scrollArea = (container: HTMLElement) => container.querySelector('.page-layout-scroll');

/** 戻るボタンとタブが固定する部分にあり、本文がスクロールする部分にあることを確かめる */
const expectFixedHeaderAndTabs = (container: HTMLElement, tabNames: string[]) => {
  const fixed = fixedArea(container);
  expect(fixed).toContainElement(screen.getByRole('button', { name: '← 戻る' }));
  for (const name of tabNames) {
    expect(fixed).toContainElement(screen.getByRole('button', { name }));
  }
};

const job: ChunkedJobDetail = {
  id: 'job-1',
  audioFileName: 'test-audio.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  status: 'completed',
  totalDurationSec: 600,
  chunkDurationSec: 600,
  totalChunks: 1,
  currentChunkIndex: 1,
  completedChunks: [],
  updatedAt: '2024-01-01T00:00:00Z',
  isProcessing: false,
};

describe('ジョブ進捗確認', () => {
  it('スクロールしても、戻るボタンとタイトルは固定し、ジョブの一覧だけをスクロールする', () => {
    const { container } = render(
      <ResumableJobsPage jobs={[job]} onBack={vi.fn()} onSelectJob={vi.fn()} onJobsDeleted={vi.fn()} />,
    );

    expectFixedHeaderAndTabs(container, []);
    expect(fixedArea(container)).toContainElement(screen.getByRole('heading', { name: 'ジョブ進捗確認' }));
    expect(scrollArea(container)).toContainElement(screen.getByText('test-audio.mp3'));
  });
});

describe('要約', () => {
  it('新規要約のタブでは、戻るボタンとタブを固定し、要約の指示だけをスクロールする', () => {
    const { container } = render(<SummaryPage transcriptionId="t-1" onBack={vi.fn()} />);

    expectFixedHeaderAndTabs(container, ['新規要約', '要約結果']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.interview-content'));
  });

  it('要約結果のタブでは、一覧と詳細をスクロールする部分の高さいっぱいに並べる', () => {
    const { container } = render(<SummaryPage transcriptionId="t-1" onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '要約結果' }));

    expectFixedHeaderAndTabs(container, ['新規要約', '要約結果']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.interview-logs-layout'));
  });
});

describe('会話分析', () => {
  const renderPage = () =>
    render(
      <InterviewPage
        transcriptionId="t-1"
        speakers={[{ id: 'A', name: 'Aさん', color: '#3b82f6' }]}
        utterances={[]}
        onBack={vi.fn()}
      />,
    );

  it('新規分析のタブでは、戻るボタンとタブを固定し、分析の入力だけをスクロールする', () => {
    const { container } = renderPage();

    expectFixedHeaderAndTabs(container, ['新規分析', '過去の分析ログ']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.interview-content'));
  });

  it('過去の分析ログのタブでは、一覧と詳細をスクロールする部分の高さいっぱいに並べる', () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '過去の分析ログ' }));

    expectFixedHeaderAndTabs(container, ['新規分析', '過去の分析ログ']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.interview-logs-layout'));
  });
});

describe('ディープサーチ', () => {
  it('新しい調査のタブでは、戻るボタンとタブを固定し、調査の入力だけをスクロールする', () => {
    const { container } = render(<ResearchPage onBack={vi.fn()} onOpenTranscription={vi.fn()} />);

    expectFixedHeaderAndTabs(container, ['新しい調査', '調査結果']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.research-content'));
  });

  it('調査結果のタブでは、一覧と詳細をスクロールする部分の高さいっぱいに並べる', () => {
    const { container } = render(<ResearchPage onBack={vi.fn()} onOpenTranscription={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '調査結果' }));

    expectFixedHeaderAndTabs(container, ['新しい調査', '調査結果']);
    expect(scrollArea(container)).toContainElement(container.querySelector('.interview-logs-layout'));
  });
});
