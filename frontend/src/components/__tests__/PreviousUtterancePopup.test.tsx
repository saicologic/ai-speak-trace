import { render, screen, fireEvent } from '@testing-library/react';
import { PreviousUtterancePopup } from '../PreviousUtterancePopup';
import { allCss, cssFilesSelecting } from '../../test/cssRules';
import type { Speaker, Utterance } from '../../types';

const sampleUtterance: Utterance = {
  speakerId: 'speaker_1',
  speakerName: 'Bさん',
  start: 65,
  end: 125,
  text: '世界について話しています',
  words: [],
};

const sampleSpeaker: Speaker = {
  id: 'speaker_1',
  name: 'Bさん',
  color: '#EF4444',
};

const defaultProps = {
  utterance: sampleUtterance,
  speaker: sampleSpeaker,
  onClose: vi.fn(),
};

describe('PreviousUtterancePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('「直前の発話」タイトルを表示する', () => {
    render(<PreviousUtterancePopup {...defaultProps} />);
    expect(screen.getByText('直前の発話')).toBeInTheDocument();
  });

  it('話者名を表示する', () => {
    render(<PreviousUtterancePopup {...defaultProps} />);
    expect(screen.getByText('Bさん')).toBeInTheDocument();
  });

  it('発話テキストを表示する', () => {
    render(<PreviousUtterancePopup {...defaultProps} />);
    expect(screen.getByText('世界について話しています')).toBeInTheDocument();
  });

  it('時刻を mm:ss - mm:ss 形式で表示する', () => {
    render(<PreviousUtterancePopup {...defaultProps} />);
    // 65秒 = 1:05、125秒 = 2:05
    expect(screen.getByText('1:05 - 2:05')).toBeInTheDocument();
  });

  it('話者の色をborderLeftColorに適用する', () => {
    const { container } = render(<PreviousUtterancePopup {...defaultProps} />);
    const content = container.querySelector('.previous-utterance-popup-content');
    expect(content).toHaveStyle({ borderLeftColor: '#EF4444' });
  });

  it('speakerがundefinedの場合はデフォルト色を使う', () => {
    const { container } = render(
      <PreviousUtterancePopup {...defaultProps} speaker={undefined} />,
    );
    const content = container.querySelector('.previous-utterance-popup-content');
    expect(content).toHaveStyle({ borderLeftColor: '#6B7280' });
  });

  it('閉じるボタンをクリックするとonCloseが呼ばれる', () => {
    const onClose = vi.fn();
    render(<PreviousUtterancePopup {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('オーバーレイをクリックするとonCloseが呼ばれる', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PreviousUtterancePopup {...defaultProps} onClose={onClose} />,
    );

    const overlay = container.querySelector('.previous-utterance-overlay');
    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ポップアップ内クリックはonCloseを呼ばない（イベント伝播を止める）', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PreviousUtterancePopup {...defaultProps} onClose={onClose} />,
    );

    const popup = container.querySelector('.previous-utterance-popup');
    fireEvent.click(popup!);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PreviousUtterancePopup の見た目', () => {
  it('画面全体を半透明の黒で覆い、ポップアップを真ん中に出す', () => {
    const { container } = render(<PreviousUtterancePopup {...defaultProps} />);
    // previous-utterance-overlay・previous-utterance-popup・previous-utterance-popup-content は、テストで探すための目印
    expect(container.querySelector('.previous-utterance-overlay')).toHaveClass(
      'fixed',
      'top-0',
      'left-0',
      'z-[1000]',
      'flex',
      'size-full',
      'items-center',
      'justify-center',
      'bg-black/30',
    );
    expect(container.querySelector('.previous-utterance-popup')).toHaveClass(
      'relative',
      'w-[90%]',
      'max-w-[520px]',
      'rounded-xl',
      'bg-white',
      'p-5',
      'shadow-[0_8px_32px]',
      'shadow-black/15',
    );
  });

  it('発話は灰色の背景に話者の色の左の線を付け、長い本文はポップアップの中でスクロールする', () => {
    const { container } = render(<PreviousUtterancePopup {...defaultProps} />);
    expect(container.querySelector('.previous-utterance-popup-content')).toHaveClass(
      'rounded-r-lg',
      'border-l-4',
      'border-l-gray-500',
      'bg-gray-50',
      'px-4',
      'py-3',
    );
    expect(screen.getByText('世界について話しています')).toHaveClass(
      'max-h-[200px]',
      'overflow-y-auto',
      'text-base',
      'leading-[1.7]',
      'text-gray-700',
    );
  });

  it('閉じるボタンは枠のない灰色の × にし、カーソルを乗せると濃くする', () => {
    render(<PreviousUtterancePopup {...defaultProps} />);
    expect(screen.getByRole('button')).toHaveClass(
      'border-none',
      'bg-transparent',
      'text-xl-minus',
      'leading-none',
      'text-gray-400',
      'hover:bg-gray-100',
      'hover:text-gray-700',
    );
  });

  it('PreviousUtterancePopup.css を残さず、目印のクラスにも見た目を指定しない', () => {
    expect(Object.keys(allCss)).not.toContain('components/PreviousUtterancePopup.css');
    for (const marker of ['previous-utterance-overlay', 'previous-utterance-popup', 'previous-utterance-popup-content']) {
      expect(cssFilesSelecting(marker)).toEqual([]);
    }
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
