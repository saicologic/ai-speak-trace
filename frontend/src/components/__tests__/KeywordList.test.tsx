import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { KeywordList } from '../KeywordList';
import { allCss } from '../../test/cssRules';

const renderList = (aiDisabled: boolean) => {
  const onNavigateSummary = vi.fn();
  render(
    <KeywordList
      keywords={[{ text: '評価', count: 3 }]}
      highlightedKeywords={new Set()}
      onToggleKeyword={vi.fn()}
      filterActive={false}
      onToggleFilter={vi.fn()}
      onNavigateSummary={onNavigateSummary}
      onNavigateInterview={vi.fn()}
      onToggleContextMode={vi.fn()}
      selectedSpeakerId={null}
      onSpeakerFilterChange={vi.fn()}
      aiDisabled={aiDisabled}
      aiStatus={<p role="status">AI 分析は OFF です</p>}
    />,
  );
  return { onNavigateSummary };
};

describe('KeywordList の AI 分析のボタン', () => {
  it('AI 分析を使えないときも、ボタンと状態を表示し、押せなくする', () => {
    const { onNavigateSummary } = renderList(true);

    expect(screen.getByRole('status')).toHaveTextContent('AI 分析は OFF です');
    for (const name of ['要約', '会話分析', '発言の文脈']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: '要約' }));
    expect(onNavigateSummary).not.toHaveBeenCalled();
  });

  it('AI 分析を使えるときは、ボタンを押せる', () => {
    const { onNavigateSummary } = renderList(false);

    fireEvent.click(screen.getByRole('button', { name: '要約' }));
    expect(onNavigateSummary).toHaveBeenCalled();
  });
});

describe('KeywordList の見た目', () => {
  const props = (overrides: Partial<ComponentProps<typeof KeywordList>> = {}): ComponentProps<typeof KeywordList> => ({
    keywords: [
      { text: '評価', count: 3 },
      { text: '型チェック', count: 2 },
    ],
    highlightedKeywords: new Set(['評価']),
    onToggleKeyword: vi.fn(),
    filterActive: false,
    onToggleFilter: vi.fn(),
    onNavigateSummary: vi.fn(),
    onToggleContextMode: vi.fn(),
    speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }],
    selectedSpeakerId: null,
    onSpeakerFilterChange: vi.fn(),
    ...overrides,
  });

  it('AI 分析のボタンは青い横いっぱいのボタンにし、押せないときは灰色にする', () => {
    render(<KeywordList {...props()} />);
    const summary = screen.getByRole('button', { name: '要約' });
    expect(summary).toHaveClass(
      'mb-3',
      'w-full',
      'rounded-lg',
      'border-none',
      'bg-primary',
      'p-2',
      'text-sm',
      'font-semibold',
      'text-white',
      'enabled:hover:bg-primary-hover',
      'disabled:bg-gray-200',
      'disabled:text-gray-400',
    );
  });

  it('発言を選んでいる間は「発言の文脈」を濃い青にし、カーソルを乗せても色を変えない', () => {
    const { rerender } = render(<KeywordList {...props({ contextSelectMode: true })} />);
    const context = screen.getByRole('button', { name: '発言の文脈（選択中...）' });
    expect(context).toHaveClass('bg-blue-800');
    // not.toHaveClass は、渡したクラスが全部そろったときだけ失敗するため、1 つずつ確かめる
    expect(context).not.toHaveClass('bg-primary');
    expect(context).not.toHaveClass('enabled:hover:bg-primary-hover');
    rerender(<KeywordList {...props({ contextSelectMode: false })} />);
    expect(screen.getByRole('button', { name: '発言の文脈' })).toHaveClass('bg-primary', 'enabled:hover:bg-primary-hover');
  });

  it('話者の絞り込みとキーワードの検索は、フォーカスすると枠の色を変える', () => {
    render(<KeywordList {...props()} />);
    expect(screen.getByText('話者フィルター')).toHaveClass('mb-1', 'block', 'text-xs', 'font-semibold', 'text-gray-500');
    expect(screen.getByRole('combobox')).toHaveClass('w-full', 'rounded-md', 'border-gray-200', 'text-sm', 'focus:border-primary', 'focus:shadow-blue-500/20');
    expect(screen.getByPlaceholderText('キーワードを検索...')).toHaveClass(
      'mb-2',
      'w-full',
      'border-gray-200',
      'text-sm',
      'focus:border-yellow-400',
      'focus:shadow-yellow-400/20',
    );
  });

  it('選んだキーワードは黄色にし、件数のバッジも黄色にする', () => {
    render(<KeywordList {...props()} />);
    const active = screen.getByRole('button', { name: '評価3' });
    expect(active).toHaveClass('border-yellow-400', 'bg-yellow-100');
    expect(Array.from(active.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);
    expect(screen.getByText('3')).toHaveClass('bg-amber-200', 'text-amber-800');
    expect(active).not.toHaveClass('bg-white');
    expect(screen.getByText('3')).not.toHaveClass('bg-gray-100');

    const inactive = screen.getByRole('button', { name: '型チェック2' });
    expect(inactive).toHaveClass('border-gray-200', 'bg-white', 'hover:border-amber-200', 'hover:bg-yellow-50');
    expect(screen.getByText('2')).toHaveClass('bg-gray-100', 'text-gray-400');
    expect(inactive).not.toHaveClass('bg-yellow-100');
    expect(screen.getByText('2')).not.toHaveClass('bg-amber-200');
  });

  it('「フィルター」ボタンは、絞り込んでいる間は青くし、押せないときは薄くする', () => {
    const { rerender } = render(<KeywordList {...props({ filterActive: true })} />);
    expect(screen.getByRole('button', { name: 'フィルター解除' })).toHaveClass('border-primary', 'bg-primary', 'text-white');
    rerender(<KeywordList {...props({ highlightedKeywords: new Set() })} />);
    const filter = screen.getByRole('button', { name: 'フィルター' });
    expect(filter).toBeDisabled();
    expect(filter).toHaveClass('bg-white', 'text-gray-500', 'disabled:opacity-40');
    expect(filter).not.toHaveClass('bg-primary');
  });

  it('キーワードの一覧だけがスクロールする', () => {
    render(<KeywordList {...props()} />);
    expect(screen.getByRole('list')).toHaveClass('flex-1', 'list-none', 'overflow-y-auto');
  });

  it('KeywordList.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/KeywordList.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
