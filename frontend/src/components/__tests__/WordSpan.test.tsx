import { render, screen } from '@testing-library/react';
import { WordSpan } from '../WordSpan';
import { allCss } from '../../test/cssRules';
import type { TranscriptionWord } from '../../types';

const word = (text: string, type: TranscriptionWord['type'] = 'word'): TranscriptionWord => ({
  text,
  start: 1,
  end: 2,
  type,
  speakerId: 'speaker_0',
});

const renderWord = (w: TranscriptionWord, isSelected = false, keywords: string[] = []) =>
  render(
    <WordSpan word={w} isSelected={isSelected} highlightedKeywords={new Set(keywords)} onClick={() => {}} />,
  );

describe('WordSpan の見た目', () => {
  it('選んでいない単語は、カーソルを乗せると薄い青にする', () => {
    renderWord(word('こんにちは'));
    const span = screen.getByText('こんにちは');
    expect(span).toHaveClass('cursor-pointer', 'rounded-xs', 'py-px', 'hover:bg-blue-500/15');
    expect(span).not.toHaveClass('bg-blue-500/30');
  });

  it('選んだ単語は濃い青にし、カーソルを乗せても色を変えない', () => {
    renderWord(word('こんにちは'), true);
    const span = screen.getByText('こんにちは');
    expect(span).toHaveClass('bg-blue-500/30');
    expect(Array.from(span.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);
  });

  it('笑い声などの音は、灰色の斜体で、少し小さい文字にする', () => {
    renderWord(word('[笑い]', 'audio_event'));
    expect(screen.getByText('[笑い]')).toHaveClass('text-gray-400', 'italic', 'text-[0.85em]');
  });

  it('キーワードは黄色の背景で目立たせる', () => {
    renderWord(word('ISUCONの話'), false, ['ISUCON']);
    const mark = screen.getByText('ISUCON');
    expect(mark.tagName).toBe('MARK');
    expect(mark).toHaveClass('rounded-xs', 'bg-yellow-200', 'px-px');
  });

  it('WordSpan.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/WordSpan.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
