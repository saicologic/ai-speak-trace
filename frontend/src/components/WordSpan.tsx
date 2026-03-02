import type { TranscriptionWord } from '../types';
import './WordSpan.css';

interface Props {
  word: TranscriptionWord;
  isSelected: boolean;
  onClick: () => void;
}

/** 時間を mm:ss 形式に変換 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 個別単語コンポーネント */
export function WordSpan({ word, isSelected, onClick }: Props) {
  if (word.type === 'spacing') {
    return <span className="word-spacing">{word.text}</span>;
  }

  if (word.type === 'audio_event') {
    return (
      <span className="word-audio-event" title={`${formatTime(word.start)}`}>
        {word.text}
      </span>
    );
  }

  return (
    <span
      className={`word-span ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      title={`${formatTime(word.start)} - ${formatTime(word.end)}`}
    >
      {word.text}
    </span>
  );
}
