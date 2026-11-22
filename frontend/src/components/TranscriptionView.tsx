import { useEffect, useMemo, useRef, useState } from 'react';
import { UtteranceBlock } from './UtteranceBlock';
import { PreviousUtterancePopup } from './PreviousUtterancePopup';
import type { Transcription } from '../types';

interface Props {
  transcription: Transcription;
  highlightedKeywords: Set<string>;
  filterActive: boolean;
  selectedSpeakerId?: string | null;
  contextSelectMode?: boolean;
  selectedUtteranceIndices?: Set<number>;
  onToggleUtteranceSelection?: (index: number) => void;
  /** スクロール先のutteranceインデックス（元配列のインデックス） */
  scrollToUtteranceIndex?: number | null;
  /** スクロール完了後のコールバック */
  onScrollComplete?: () => void;
  /** タイムスタンプクリック時のコールバック */
  onTimeClick?: (startTime: number) => void;
}

/** 会話に飛んだ発言を目立たせるアニメーション（背景の色を 2 秒で消す） */
const JUMP_HIGHLIGHT_CLASS = 'animate-jump-highlight';

/** 発話を包む箱：発話を選ぶときは、チェックボックスと発話の間をあけ、カーソルを乗せると薄い紫にする */
const wrapperClass = 'flex items-start';
const selectableWrapperClass = 'gap-3 rounded-lg p-1 transition-colors duration-150 hover:bg-purple-50';

/** 文字起こし結果表示コンポーネント */
export function TranscriptionView({
  transcription,
  highlightedKeywords,
  filterActive,
  selectedSpeakerId,
  contextSelectMode,
  selectedUtteranceIndices,
  onToggleUtteranceSelection,
  scrollToUtteranceIndex,
  onScrollComplete,
  onTimeClick,
}: Props) {
  const [selectedWords, setSelectedWords] = useState<Set<number>>(new Set());
  // 直前発話ポップアップ用の状態（元配列のインデックスを保持）
  const [previousUtteranceIndex, setPreviousUtteranceIndex] = useState<number | null>(null);
  // 各utterance要素へのref（元配列のインデックスをキーとする）
  const utteranceRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // スクロール先が指定されたら該当要素にスクロール＋ハイライト
  useEffect(() => {
    if (scrollToUtteranceIndex == null) return;
    const el = utteranceRefs.current.get(scrollToUtteranceIndex);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add(JUMP_HIGHLIGHT_CLASS);
      // ハイライトを2秒後に消す
      const timer = setTimeout(() => el.classList.remove(JUMP_HIGHLIGHT_CLASS), 2000);
      onScrollComplete?.();
      return () => {
        clearTimeout(timer);
        el.classList.remove(JUMP_HIGHLIGHT_CLASS);
      };
    }
    onScrollComplete?.();
  }, [scrollToUtteranceIndex]);

  const toggleWord = (index: number) => {
    setSelectedWords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  /** フィルター適用時に表示する発話を絞り込み */
  const displayUtterances = useMemo(() => {
    // 話者フィルター → キーワードフィルターの順に適用
    let base = transcription.utterances.map((utterance, i) => ({ utterance, index: i }));

    // 話者フィルター
    if (selectedSpeakerId) {
      base = base.filter(({ utterance }) => utterance.speakerId === selectedSpeakerId);
    }

    if (!filterActive || highlightedKeywords.size === 0) {
      return base;
    }
    // キーワードの各部分（スペース区切り・文字種境界）も展開して照合
    const expandedKeywords: string[] = [];
    for (const kw of highlightedKeywords) {
      expandedKeywords.push(kw.toLowerCase());
      if (kw.includes(' ')) {
        for (const part of kw.split(/\s+/)) {
          if (part.length >= 2) expandedKeywords.push(part.toLowerCase());
        }
      }
      const scriptParts = kw.match(/[A-Za-z0-9]+|[ァ-ヴー・]+|[一-龯々]+|[ぁ-ん]+/g);
      if (scriptParts && scriptParts.length > 1) {
        for (const part of scriptParts) {
          if (part.length >= 2) expandedKeywords.push(part.toLowerCase());
        }
      }
    }
    return base.filter(({ utterance }) => {
      const text = utterance.text.toLowerCase();
      return expandedKeywords.some((kw) => text.includes(kw));
    });
  }, [transcription.utterances, highlightedKeywords, filterActive, selectedSpeakerId]);

  // 各utteranceのword開始インデックスを計算（全utterance分）
  const wordOffsets = useMemo(() => {
    const offsets: number[] = [];
    let offset = 0;
    for (const utterance of transcription.utterances) {
      offsets.push(offset);
      offset += utterance.words.length;
    }
    return offsets;
  }, [transcription.utterances]);

  /** 発話ブロッククリック時：話者フィルター中なら直前の発話をポップアップ表示 */
  const handleUtteranceClick = (originalIndex: number) => {
    if (!selectedSpeakerId) return;
    if (originalIndex <= 0) return;
    const prevUtterance = transcription.utterances[originalIndex - 1];
    // 直前が別の話者の場合のみ表示
    if (prevUtterance && prevUtterance.speakerId !== selectedSpeakerId) {
      setPreviousUtteranceIndex(originalIndex - 1);
    }
  };

  // ポップアップに表示する直前発話データ
  const popupUtterance = previousUtteranceIndex !== null
    ? transcription.utterances[previousUtteranceIndex]
    : null;
  const popupSpeaker = popupUtterance
    ? transcription.speakers.find((s) => s.id === popupUtterance.speakerId)
    : undefined;

  return (
    <div>
      <h3 className="mb-4 text-lg font-semibold">文字起こし結果</h3>

      {selectedWords.size > 0 && (
        // selection-info は、テストで選んだ単語の数の表示を探すための目印
        <div className="selection-info mb-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-md text-blue-800">
          <span>{selectedWords.size} 単語を選択中</span>
          <button
            className="border-blue-300 bg-transparent px-[0.5em] py-[0.2em] text-xs text-blue-800"
            onClick={() => setSelectedWords(new Set())}
          >
            選択解除
          </button>
        </div>
      )}

      {(selectedSpeakerId || (filterActive && highlightedKeywords.size > 0)) && (
        <div className="mb-4 rounded-md border border-amber-200 bg-yellow-50 px-3 py-[0.4rem] text-sm text-amber-800">
          {displayUtterances.length}件の発話を表示中（全{transcription.utterances.length}件）
        </div>
      )}

      <div className="flex flex-col">
        {displayUtterances.map(({ utterance, index }) => {
          const speaker = transcription.speakers.find(
            (s) => s.id === utterance.speakerId,
          );

          return (
            <div
              key={index}
              ref={(el) => {
                if (el) utteranceRefs.current.set(index, el);
              }}
              className={contextSelectMode ? `${wrapperClass} ${selectableWrapperClass}` : wrapperClass}
            >
              {contextSelectMode && (
                <input
                  type="checkbox"
                  className="mt-4 size-[1.1rem] shrink-0 cursor-pointer accent-violet-500"
                  checked={selectedUtteranceIndices?.has(index) ?? false}
                  onChange={() => onToggleUtteranceSelection?.(index)}
                />
              )}
              <UtteranceBlock
                utterance={utterance}
                speaker={speaker}
                selectedWords={selectedWords}
                highlightedKeywords={highlightedKeywords}
                wordIndexOffset={wordOffsets[index]}
                onWordClick={toggleWord}
                clickable={!!selectedSpeakerId && index > 0}
                onBlockClick={() => handleUtteranceClick(index)}
                onTimeClick={onTimeClick}
              />
            </div>
          );
        })}
      </div>

      {popupUtterance && (
        <PreviousUtterancePopup
          utterance={popupUtterance}
          speaker={popupSpeaker}
          onClose={() => setPreviousUtteranceIndex(null)}
        />
      )}
    </div>
  );
}
