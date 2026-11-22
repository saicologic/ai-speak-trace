import { WordSpan } from './WordSpan';
import type { Speaker, Utterance } from '../types';

interface Props {
  utterance: Utterance;
  speaker: Speaker | undefined;
  selectedWords: Set<number>;
  highlightedKeywords: Set<string>;
  wordIndexOffset: number;
  onWordClick: (globalIndex: number) => void;
  clickable?: boolean;
  onBlockClick?: () => void;
  onTimeClick?: (startTime: number) => void;
}

/**
 * 発話のカード：話者の色の左の線を付ける（色は style で渡す）。左右に並べたときは残りの幅を使う
 * utterance-block は、テストで発話のブロックを探すための目印
 */
const blockClass =
  'utterance-block mb-4 flex-1 rounded-r-lg border-l-4 border-l-gray-500 bg-white px-4 py-3 shadow-[0_1px_2px] shadow-black/4';
/** 押せる発話（話者で絞り込んだとき）：カーソルを乗せると薄い灰色にする */
const clickableBlockClass = 'cursor-pointer transition-colors duration-150 hover:bg-gray-50';

/** 時刻：押せるときは、カーソルを乗せると青くする */
const timeClass = 'text-xs text-gray-400';
const clickableTimeClass =
  'cursor-pointer rounded-sm px-[0.3rem] py-[0.1rem] transition-colors duration-150 hover:bg-blue-50 hover:text-blue-500';

/** 時間を mm:ss 形式に変換 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 発話ブロックコンポーネント */
export function UtteranceBlock({
  utterance,
  speaker,
  selectedWords,
  highlightedKeywords,
  wordIndexOffset,
  onWordClick,
  clickable,
  onBlockClick,
  onTimeClick,
}: Props) {
  const borderColor = speaker?.color ?? '#6B7280';

  return (
    <div
      className={clickable ? `${blockClass} ${clickableBlockClass}` : blockClass}
      style={{ borderLeftColor: borderColor }}
      onClick={clickable ? onBlockClick : undefined}
    >
      <div className="mb-2 flex items-center gap-3">
        <span
          className="text-md font-semibold"
          style={{ color: borderColor }}
        >
          {utterance.speakerName}
        </span>
        <span
          className={onTimeClick ? `${timeClass} ${clickableTimeClass}` : timeClass}
          onClick={onTimeClick ? (e) => {
            e.stopPropagation();
            onTimeClick(utterance.start);
          } : undefined}
          title={onTimeClick ? 'クリックでこの位置から再生' : undefined}
        >
          {formatTime(utterance.start)} - {formatTime(utterance.end)}
        </span>
      </div>
      <div className="text-base-plus leading-[1.8]">
        {utterance.words.map((word, i) => {
          const globalIndex = wordIndexOffset + i;
          return (
            <WordSpan
              key={globalIndex}
              word={word}
              isSelected={selectedWords.has(globalIndex)}
              highlightedKeywords={highlightedKeywords}
              onClick={() => onWordClick(globalIndex)}
              onTimeClick={onTimeClick}
            />
          );
        })}
      </div>
    </div>
  );
}
