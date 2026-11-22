import { render, screen, fireEvent } from '@testing-library/react';
import { UtteranceBlock } from '../UtteranceBlock';
import { allCss } from '../../test/cssRules';
import type { Utterance, Speaker } from '../../types';

vi.mock('../WordSpan', () => ({
  WordSpan: ({ word, onClick, onTimeClick }: {
    word: { text: string; type: string; start: number; end: number; speakerId: string };
    isSelected: boolean;
    highlightedKeywords: Set<string>;
    onClick: () => void;
    onTimeClick?: (t: number) => void;
  }) => (
    <span data-testid={`word-${word.text}`} onClick={() => { onClick(); onTimeClick?.(word.start); }}>
      {word.text}
    </span>
  ),
}));

/** テスト用の発話データ */
const sampleUtterance: Utterance = {
  speakerId: 'speaker_0',
  speakerName: 'Aさん',
  start: 65,
  end: 125,
  text: 'こんにちは',
  words: [
    { text: 'こんにちは', start: 65, end: 70, type: 'word', speakerId: 'speaker_0' },
  ],
};

const sampleSpeaker: Speaker = {
  id: 'speaker_0',
  name: 'Aさん',
  color: '#3B82F6',
};

const defaultProps = {
  utterance: sampleUtterance,
  speaker: sampleSpeaker,
  selectedWords: new Set<number>(),
  highlightedKeywords: new Set<string>(),
  wordIndexOffset: 0,
  onWordClick: vi.fn(),
};

describe('UtteranceBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('話者名を表示する', () => {
    render(<UtteranceBlock {...defaultProps} />);
    expect(screen.getByText('Aさん')).toBeInTheDocument();
  });

  it('開始・終了時刻を mm:ss - mm:ss 形式で表示する', () => {
    render(<UtteranceBlock {...defaultProps} />);
    // 65秒 = 1:05、125秒 = 2:05
    expect(screen.getByText('1:05 - 2:05')).toBeInTheDocument();
  });

  it('話者の色をborderLeftColorに適用する', () => {
    const { container } = render(<UtteranceBlock {...defaultProps} />);
    const block = container.querySelector('.utterance-block');
    expect(block).toHaveStyle({ borderLeftColor: '#3B82F6' });
  });

  it('speakerがundefinedの場合はデフォルト色を使う', () => {
    const { container } = render(<UtteranceBlock {...defaultProps} speaker={undefined} />);
    const block = container.querySelector('.utterance-block');
    expect(block).toHaveStyle({ borderLeftColor: '#6B7280' });
  });

  it('単語コンポーネントが表示される', () => {
    render(<UtteranceBlock {...defaultProps} />);
    expect(screen.getByTestId('word-こんにちは')).toBeInTheDocument();
  });

  it('単語クリックでonWordClickが呼ばれる', () => {
    const onWordClick = vi.fn();
    render(<UtteranceBlock {...defaultProps} onWordClick={onWordClick} wordIndexOffset={5} />);

    fireEvent.click(screen.getByTestId('word-こんにちは'));

    // wordIndexOffset(5) + word index(0) = 5
    expect(onWordClick).toHaveBeenCalledWith(5);
  });

  it('clickable=trueでブロッククリック時にonBlockClickが呼ばれる', () => {
    const onBlockClick = vi.fn();
    const { container } = render(
      <UtteranceBlock {...defaultProps} clickable onBlockClick={onBlockClick} />,
    );
    const block = container.querySelector('.utterance-block');

    fireEvent.click(block!);

    expect(onBlockClick).toHaveBeenCalled();
  });

  it('clickable=falseの場合はブロッククリックが無効', () => {
    const onBlockClick = vi.fn();
    const { container } = render(
      <UtteranceBlock {...defaultProps} clickable={false} onBlockClick={onBlockClick} />,
    );
    const block = container.querySelector('.utterance-block');

    fireEvent.click(block!);

    expect(onBlockClick).not.toHaveBeenCalled();
  });

  it('onTimeClickが渡された場合、時刻クリックでonTimeClickが呼ばれる', () => {
    const onTimeClick = vi.fn();
    render(<UtteranceBlock {...defaultProps} onTimeClick={onTimeClick} />);

    fireEvent.click(screen.getByText('1:05 - 2:05'));

    expect(onTimeClick).toHaveBeenCalledWith(65);
  });

  it('onTimeClickが渡されていない場合、時刻クリックは何もしない', () => {
    render(<UtteranceBlock {...defaultProps} onTimeClick={undefined} />);
    // エラーなく動作すること
    fireEvent.click(screen.getByText('1:05 - 2:05'));
  });
});

describe('UtteranceBlock の見た目', () => {
  it('発話は、白いカードに話者の色の左の線を付け、左右に並べたときは残りの幅を使う', () => {
    const { container } = render(<UtteranceBlock {...defaultProps} />);
    // utterance-block は、テストで発話のブロックを探すための目印
    const block = container.querySelector('.utterance-block');
    expect(block).toHaveClass(
      'mb-4',
      'flex-1',
      'rounded-r-lg',
      'border-l-4',
      'border-l-gray-500',
      'bg-white',
      'px-4',
      'py-3',
      'shadow-[0_1px_2px]',
      'shadow-black/4',
    );
  });

  it('押せる発話は、カーソルを乗せると薄い灰色にし、押せない発話は変えない', () => {
    const { container, rerender } = render(<UtteranceBlock {...defaultProps} clickable />);
    expect(container.querySelector('.utterance-block')).toHaveClass('cursor-pointer', 'hover:bg-gray-50');
    rerender(<UtteranceBlock {...defaultProps} clickable={false} />);
    expect(container.querySelector('.utterance-block')).not.toHaveClass('cursor-pointer');
    expect(container.querySelector('.utterance-block')).not.toHaveClass('hover:bg-gray-50');
  });

  it('押せる時刻は、カーソルを乗せると青くし、押せない時刻は灰色のままにする', () => {
    const { rerender } = render(<UtteranceBlock {...defaultProps} onTimeClick={vi.fn()} />);
    expect(screen.getByText('1:05 - 2:05')).toHaveClass('text-xs', 'text-gray-400', 'cursor-pointer', 'hover:bg-blue-50', 'hover:text-blue-500');
    rerender(<UtteranceBlock {...defaultProps} />);
    expect(screen.getByText('1:05 - 2:05')).toHaveClass('text-xs', 'text-gray-400');
    expect(screen.getByText('1:05 - 2:05')).not.toHaveClass('cursor-pointer');
  });

  it('話者名は太字、本文は少し大きい文字で行の間を広くとる', () => {
    render(<UtteranceBlock {...defaultProps} />);
    expect(screen.getByText('Aさん')).toHaveClass('text-md', 'font-semibold');
    expect(screen.getByTestId('word-こんにちは').parentElement).toHaveClass('text-base-plus', 'leading-[1.8]');
  });

  it('UtteranceBlock.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/UtteranceBlock.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
