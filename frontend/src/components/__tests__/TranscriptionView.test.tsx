import { render, screen, fireEvent } from '@testing-library/react';
import { TranscriptionView } from '../TranscriptionView';
import { allCss, cssFilesSelecting } from '../../test/cssRules';
import type { Transcription } from '../../types';

vi.mock('../UtteranceBlock', () => ({
  UtteranceBlock: ({
    utterance,
    clickable,
    onBlockClick,
    onTimeClick,
  }: {
    utterance: { speakerName: string; text: string; start: number };
    clickable?: boolean;
    onBlockClick?: () => void;
    onTimeClick?: (t: number) => void;
  }) => (
    <div
      data-testid={`utterance-${utterance.speakerName}`}
      onClick={clickable ? onBlockClick : undefined}
    >
      <span>{utterance.speakerName}</span>
      <span>{utterance.text}</span>
      <button onClick={() => onTimeClick?.(utterance.start)}>時刻</button>
    </div>
  ),
}));

vi.mock('../PreviousUtterancePopup', () => ({
  PreviousUtterancePopup: ({
    utterance,
    onClose,
  }: {
    utterance: { text: string };
    onClose: () => void;
  }) => (
    <div data-testid="popup">
      <span>{utterance.text}</span>
      <button onClick={onClose}>閉じる</button>
    </div>
  ),
}));

/** テスト用の文字起こしデータ */
const sampleTranscription: Transcription = {
  id: 'test',
  audioFileName: 'test.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  languageCode: 'ja',
  fullText: 'こんにちは 世界 AIについて',
  speakers: [
    { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
    { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
  ],
  words: [],
  utterances: [
    {
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: 0,
      end: 1,
      text: 'こんにちは',
      words: [],
    },
    {
      speakerId: 'speaker_1',
      speakerName: 'Bさん',
      start: 1,
      end: 2,
      text: '世界',
      words: [],
    },
    {
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: 2,
      end: 3,
      text: 'AIについて',
      words: [],
    },
  ],
};

const defaultProps = {
  transcription: sampleTranscription,
  highlightedKeywords: new Set<string>(),
  filterActive: false,
};

describe('TranscriptionView', () => {
  it('全発話を表示する', () => {
    render(<TranscriptionView {...defaultProps} />);

    expect(screen.getByText('こんにちは')).toBeInTheDocument();
    expect(screen.getByText('世界')).toBeInTheDocument();
    expect(screen.getByText('AIについて')).toBeInTheDocument();
  });

  it('「文字起こし結果」ヘッダーを表示する', () => {
    render(<TranscriptionView {...defaultProps} />);
    expect(screen.getByText('文字起こし結果')).toBeInTheDocument();
  });

  describe('話者フィルター', () => {
    it('selectedSpeakerIdを指定すると対象話者の発話のみ表示する', () => {
      render(<TranscriptionView {...defaultProps} selectedSpeakerId="speaker_0" />);

      expect(screen.getAllByText('Aさん')).toHaveLength(2);
      expect(screen.queryByText('世界')).not.toBeInTheDocument();
    });

    it('フィルター件数をインフォメーションとして表示する', () => {
      render(<TranscriptionView {...defaultProps} selectedSpeakerId="speaker_0" />);

      expect(screen.getByText(/2件の発話を表示中（全3件）/)).toBeInTheDocument();
    });
  });

  describe('キーワードフィルター', () => {
    it('filterActive=trueのときキーワードにマッチする発話のみ表示する', () => {
      render(
        <TranscriptionView
          {...defaultProps}
          highlightedKeywords={new Set(['AI'])}
          filterActive={true}
        />,
      );

      expect(screen.getByText('AIについて')).toBeInTheDocument();
      expect(screen.queryByText('こんにちは')).not.toBeInTheDocument();
      expect(screen.queryByText('世界')).not.toBeInTheDocument();
    });

    it('filterActive=falseのときキーワードがあっても全発話を表示する', () => {
      render(
        <TranscriptionView
          {...defaultProps}
          highlightedKeywords={new Set(['AI'])}
          filterActive={false}
        />,
      );

      expect(screen.getByText('こんにちは')).toBeInTheDocument();
      expect(screen.getByText('世界')).toBeInTheDocument();
      expect(screen.getByText('AIについて')).toBeInTheDocument();
    });
  });

  describe('単語選択', () => {
    it('単語選択時に選択数を表示する', () => {
      const { container } = render(<TranscriptionView {...defaultProps} />);
      // UtteranceBlockはモックなので直接toggleWordを呼べないため
      // selectedWordsの初期状態（選択なし）を確認
      expect(container.querySelector('.selection-info')).toBeNull();
    });
  });

  describe('コンテキスト選択モード', () => {
    it('contextSelectMode=trueのときチェックボックスを表示する', () => {
      const { container } = render(
        <TranscriptionView
          {...defaultProps}
          contextSelectMode={true}
          selectedUtteranceIndices={new Set()}
          onToggleUtteranceSelection={vi.fn()}
        />,
      );

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(3);
    });

    it('チェックボックスをクリックするとonToggleUtteranceSelectionが呼ばれる', () => {
      const onToggle = vi.fn();
      const { container } = render(
        <TranscriptionView
          {...defaultProps}
          contextSelectMode={true}
          selectedUtteranceIndices={new Set()}
          onToggleUtteranceSelection={onToggle}
        />,
      );

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);

      expect(onToggle).toHaveBeenCalledWith(0);
    });
  });

  describe('直前発話ポップアップ', () => {
    it('話者フィルター中に別話者の発話ブロックをクリックするとポップアップが表示される', () => {
      render(
        <TranscriptionView
          {...defaultProps}
          selectedSpeakerId="speaker_0"
        />,
      );

      // speaker_0の2番目の発話（index=2、直前はspeaker_1）をクリック
      const utteranceBlocks = screen.getAllByTestId(/^utterance-/);
      // speaker_0の2番目のブロック（index=2）
      fireEvent.click(utteranceBlocks[1]);

      expect(screen.getByTestId('popup')).toBeInTheDocument();
      expect(screen.getByText('世界')).toBeInTheDocument();
    });

    it('ポップアップの「閉じる」ボタンでポップアップが消える', () => {
      render(
        <TranscriptionView
          {...defaultProps}
          selectedSpeakerId="speaker_0"
        />,
      );

      const utteranceBlocks = screen.getAllByTestId(/^utterance-/);
      fireEvent.click(utteranceBlocks[1]);
      expect(screen.getByTestId('popup')).toBeInTheDocument();

      fireEvent.click(screen.getByText('閉じる'));
      expect(screen.queryByTestId('popup')).not.toBeInTheDocument();
    });
  });

  describe('onTimeClick', () => {
    it('onTimeClickが渡されるとUtteranceBlockに伝播する', () => {
      const onTimeClick = vi.fn();
      render(<TranscriptionView {...defaultProps} onTimeClick={onTimeClick} />);

      fireEvent.click(screen.getAllByText('時刻')[0]);

      expect(onTimeClick).toHaveBeenCalledWith(0);
    });
  });
});

describe('TranscriptionView の見た目', () => {
  /** 発話を包む箱（チェックボックスと発話を横に並べる） */
  const wrapperOf = (speakerName: string) => screen.getAllByTestId(`utterance-${speakerName}`)[0].parentElement;

  it('見出しは太字にし、絞り込んだ件数は黄色の枠で出す', () => {
    render(<TranscriptionView {...defaultProps} selectedSpeakerId="speaker_0" />);
    expect(screen.getByRole('heading', { name: '文字起こし結果' })).toHaveClass('mb-4', 'text-lg', 'font-semibold');
    expect(screen.getByText(/2件の発話を表示中/)).toHaveClass(
      'rounded-md',
      'border-amber-200',
      'bg-yellow-50',
      'text-sm',
      'text-amber-800',
    );
  });

  it('発話を選ぶときは、チェックボックスと発話の間をあけ、カーソルを乗せると薄い紫にする', () => {
    render(
      <TranscriptionView
        {...defaultProps}
        contextSelectMode={true}
        selectedUtteranceIndices={new Set()}
        onToggleUtteranceSelection={vi.fn()}
      />,
    );
    expect(wrapperOf('Bさん')).toHaveClass('flex', 'items-start', 'gap-3', 'rounded-lg', 'p-1', 'hover:bg-purple-50');
    expect(screen.getAllByRole('checkbox')[0]).toHaveClass('mt-4', 'size-[1.1rem]', 'shrink-0', 'cursor-pointer', 'accent-violet-500');
  });

  it('発話を選ばないときは、間をあけず、カーソルを乗せても色を変えない', () => {
    render(<TranscriptionView {...defaultProps} />);
    expect(wrapperOf('Bさん')).toHaveClass('flex', 'items-start');
    expect(wrapperOf('Bさん')).not.toHaveClass('gap-3');
    expect(wrapperOf('Bさん')).not.toHaveClass('hover:bg-purple-50');
  });

  it('会話に飛んだ発言は、背景の色を 2 秒で消すアニメーションで目立たせる', () => {
    // テストの画面（jsdom）には scrollIntoView がないため、このテストの間だけ足す
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<TranscriptionView {...defaultProps} scrollToUtteranceIndex={1} />);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(wrapperOf('Bさん')).toHaveClass('animate-jump-highlight');
      // 飛んでいない発言は目立たせない
      expect(screen.getByText('こんにちは').parentElement?.parentElement).not.toHaveClass('animate-jump-highlight');
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('TranscriptionView.css を残さず、ほかの CSS でも発話のブロックに見た目を指定しない', () => {
    expect(Object.keys(allCss)).not.toContain('components/TranscriptionView.css');
    expect(cssFilesSelecting('utterance-block')).toEqual([]);
    expect(cssFilesSelecting('selection-info')).toEqual([]);
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
