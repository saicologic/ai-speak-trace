import { useEffect, useRef } from 'react';
import type { Speaker, Utterance } from '../types';
import './PreviousUtterancePopup.css';

interface Props {
  utterance: Utterance;
  speaker: Speaker | undefined;
  onClose: () => void;
}

/** 時間を mm:ss 形式に変換 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 直前の発話をポップアップ表示するコンポーネント */
export function PreviousUtterancePopup({ utterance, speaker, onClose }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const borderColor = speaker?.color ?? '#6B7280';

  // マウント時にテキスト領域を一番下までスクロール
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [utterance]);

  return (
    <div className="previous-utterance-overlay" onClick={onClose}>
      <div
        className="previous-utterance-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="previous-utterance-popup-header">
          <span className="previous-utterance-popup-title">直前の発話</span>
          <button className="previous-utterance-popup-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div
          className="previous-utterance-popup-content"
          style={{ borderLeftColor: borderColor }}
        >
          <div className="previous-utterance-popup-speaker">
            <span
              className="previous-utterance-popup-speaker-name"
              style={{ color: borderColor }}
            >
              {utterance.speakerName}
            </span>
            <span className="previous-utterance-popup-time">
              {formatTime(utterance.start)} - {formatTime(utterance.end)}
            </span>
          </div>
          <div className="previous-utterance-popup-text" ref={textRef}>
            {utterance.text}
          </div>
        </div>
      </div>
    </div>
  );
}
