import { render, screen, fireEvent } from '@testing-library/react';
import { PreviousUtterancePopup } from '../PreviousUtterancePopup';
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
