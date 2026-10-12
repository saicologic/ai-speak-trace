import { fireEvent, render, screen } from '@testing-library/react';
import { KeywordList } from '../KeywordList';

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
