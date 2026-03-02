import { WordSpan } from './WordSpan';
import type { Speaker, Utterance } from '../types';
import './UtteranceBlock.css';

interface Props {
  utterance: Utterance;
  speaker: Speaker | undefined;
  selectedWords: Set<number>;
  wordIndexOffset: number;
  onWordClick: (globalIndex: number) => void;
}

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
  wordIndexOffset,
  onWordClick,
}: Props) {
  const borderColor = speaker?.color ?? '#6B7280';

  return (
    <div
      className="utterance-block"
      style={{ borderLeftColor: borderColor }}
    >
      <div className="utterance-header">
        <span
          className="utterance-speaker-name"
          style={{ color: borderColor }}
        >
          {utterance.speakerName}
        </span>
        <span className="utterance-time">
          {formatTime(utterance.start)} - {formatTime(utterance.end)}
        </span>
      </div>
      <div className="utterance-text">
        {utterance.words.map((word, i) => {
          const globalIndex = wordIndexOffset + i;
          return (
            <WordSpan
              key={globalIndex}
              word={word}
              isSelected={selectedWords.has(globalIndex)}
              onClick={() => onWordClick(globalIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}
