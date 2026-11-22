import { fireEvent, render, screen } from '@testing-library/react';
import { InterviewPage } from '../InterviewPage';
import { fetchAnalysisLog, fetchAnalysisLogs, fetchPrivacy, generateQuestions } from '../../api/client';
import { allCss, cssFilesSelecting } from '../../test/cssRules';
import type { InterviewAnalysis, PrivacyStatus, Utterance } from '../../types';

vi.mock('../../api/client');

const utterance = (text: string): Utterance => ({
  speakerId: 'A',
  speakerName: 'Aさん',
  start: 0,
  end: 1,
  text,
  words: [],
});

const log: InterviewAnalysis = {
  id: 'a1',
  transcriptionId: 't-1',
  speakerId: 'A',
  speakerName: 'Aさん',
  keywords: ['ISUCON'],
  createdAt: '2026-11-20T10:00:00.000Z',
  model: 'claude-test',
  results: [
    {
      question: '質問その1',
      answer: '## 見出し\n\n回答の本文。`code` と [リンク](https://example.com)\n\n- 箇条書き',
      sources: [{ title: '出典のページ', url: 'https://example.com/a' }],
    },
  ],
};

const renderPage = () =>
  render(
    <InterviewPage
      transcriptionId="t-1"
      speakers={[{ id: 'A', name: 'Aさん', color: '#3b82f6' }]}
      utterances={[utterance('ISUCONの話をします。ISUCONは楽しい。スコアを上げる。スコアが大事。')]}
      onBack={vi.fn()}
    />,
  );

describe('InterviewPage の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchPrivacy).mockResolvedValue({ configured: true, scanning: false, scan: null } as PrivacyStatus);
    vi.mocked(fetchAnalysisLogs).mockResolvedValue([log]);
    vi.mocked(fetchAnalysisLog).mockResolvedValue(log);
    vi.mocked(generateQuestions).mockResolvedValue(['生成した質問']);
  });

  it('画面の背景は薄い灰色にし、ヘッダーは紺、タブは選んでいるほうを白くして青い下線を引く', () => {
    const { container } = renderPage();
    expect(container.firstElementChild).toHaveClass('bg-gray-50');
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.parentElement).toHaveClass('flex', 'items-center', 'gap-4', 'bg-brand', 'px-8', 'py-4', 'text-white');
    expect(back).toHaveClass('rounded-md', 'border-white/30', 'bg-transparent', 'text-md', 'text-white', 'hover:bg-white/10');
    const active = screen.getByRole('button', { name: '新規分析' });
    expect(active.parentElement).toHaveClass('flex', 'border-b', 'border-gray-200', 'bg-gray-100');
    expect(active).toHaveClass('border-b-2', 'border-b-primary', 'bg-white', 'text-base', 'font-medium', 'text-blue-700');
    expect(Array.from(active.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);
    expect(screen.getByRole('button', { name: '過去の分析ログ' })).toHaveClass(
      'border-b-2',
      'border-b-transparent',
      'bg-transparent',
      'text-gray-500',
      'hover:bg-gray-200',
      'hover:text-gray-700',
    );
  });

  it('入力の欄は、見出しの下に並べ、キーワードは丸い札にする（選んだ札は黄色）', () => {
    const { container } = renderPage();
    // interview-content は、テストでスクロールする部分の中身を探すための目印
    expect(container.querySelector('.interview-content')).toHaveClass('mx-auto', 'w-full', 'max-w-[800px]', 'flex-1', 'p-8');
    const heading = screen.getByRole('heading', { name: '話者を選択' });
    expect(heading).toHaveClass('mb-3', 'text-lg', 'font-semibold', 'text-gray-800');
    expect(heading.parentElement).toHaveClass('mb-8');
    expect(screen.getByRole('combobox')).toHaveClass('w-full', 'max-w-[300px]', 'rounded-lg', 'border-gray-200', 'text-base', 'focus:border-primary');

    const tag = screen.getByRole('button', { name: 'ISUCON' });
    expect(tag).toHaveClass('rounded-xl', 'border', 'text-sm', 'border-gray-200', 'bg-gray-100', 'text-gray-500', 'hover:bg-yellow-50');
    fireEvent.click(tag);
    expect(tag).toHaveClass('border-yellow-400', 'bg-yellow-100', 'text-amber-800');
    expect(Array.from(tag.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);
  });

  it('生成した質問は、白い枠の中にチェックボックスと並べ、分析のボタンは青くする', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ISUCON' }));
    expect(screen.getByRole('button', { name: '質問を生成' })).toHaveClass('rounded-lg', 'border', 'border-gray-200', 'bg-gray-100', 'text-gray-700', 'enabled:hover:bg-gray-200');
    fireEvent.click(screen.getByRole('button', { name: '質問を生成' }));
    const question = await screen.findByText('生成した質問');
    expect(question).toHaveClass('text-md', 'leading-[1.6]', 'text-gray-700');
    expect(question.parentElement).toHaveClass('flex', 'cursor-pointer', 'items-start', 'gap-3', 'border-b', 'border-gray-100', 'last:border-b-0', 'hover:bg-gray-50');
    expect(question.parentElement?.parentElement).toHaveClass('mt-3', 'overflow-hidden', 'rounded-lg', 'border', 'border-gray-200', 'bg-white');
    expect(screen.getByRole('button', { name: '分析する（1件）' })).toHaveClass('rounded-lg', 'border-none', 'bg-primary', 'text-white', 'enabled:hover:bg-primary-hover', 'disabled:opacity-50');
  });

  it('過去の分析ログは、灰色の一覧と、白いカードの詳細を並べ、回答の Markdown にも見た目を付ける', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '過去の分析ログ' }));
    // interview-logs-layout は、テストで一覧と詳細を並べる箱を探すための目印
    expect(container.querySelector('.interview-logs-layout')).toHaveClass('flex', 'min-h-0', 'flex-1', 'overflow-hidden');
    const item = (await screen.findByText('Aさん')).closest('button');
    expect(item).toHaveClass('block', 'w-full', 'border-b', 'border-b-gray-200', 'px-4', 'py-3', 'text-left', 'bg-transparent', 'hover:bg-gray-200');
    expect(item?.parentElement).toHaveClass('flex', 'w-[260px]', 'shrink-0', 'flex-col', 'overflow-y-auto', 'border-r', 'border-gray-200', 'bg-gray-50');
    fireEvent.click(item!);
    expect(item).toHaveClass('border-l-3', 'border-l-primary', 'bg-blue-50');

    const question = await screen.findByRole('heading', { name: 'Q1: 質問その1' });
    expect(question).toHaveClass('mb-3', 'text-base-plus', 'font-semibold', 'text-blue-800');
    expect(question.parentElement).toHaveClass('rounded-[10px]', 'border', 'border-gray-200', 'bg-white', 'p-5');
    expect(question.nextElementSibling).toHaveClass(
      'text-base',
      'leading-[1.7]',
      'text-gray-700',
      '[&_p]:my-2',
      '[&_:is(h1,h2,h3,h4)]:text-base',
      '[&_a]:text-primary',
      '[&_code]:bg-gray-100',
      '[&_pre_code]:bg-transparent',
    );
    expect(screen.getByRole('link', { name: '出典のページ' })).toHaveClass('rounded-sm', 'bg-blue-50', 'text-xs', 'text-primary', 'hover:bg-blue-100', 'hover:underline');
  });

  it('InterviewPage.css を残さず、目印のクラスにも見た目を指定しない', () => {
    expect(Object.keys(allCss)).not.toContain('components/InterviewPage.css');
    expect(cssFilesSelecting('interview-content')).toEqual([]);
    expect(cssFilesSelecting('interview-logs-layout')).toEqual([]);
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
