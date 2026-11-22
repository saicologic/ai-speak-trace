import { useEffect, useRef } from 'react';
import type { Speaker, Utterance } from '../types';

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
    // previous-utterance-overlay・previous-utterance-popup・previous-utterance-popup-content は、テストで探すための目印
    <div
      className="previous-utterance-overlay fixed top-0 left-0 z-[1000] flex size-full items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="previous-utterance-popup relative w-[90%] max-w-[520px] rounded-xl bg-white p-5 shadow-[0_8px_32px] shadow-black/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-500">直前の発話</span>
          <button
            className="rounded-sm border-none bg-transparent p-1 text-xl-minus leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div
          className="previous-utterance-popup-content rounded-r-lg border-l-4 border-l-gray-500 bg-gray-50 px-4 py-3"
          style={{ borderLeftColor: borderColor }}
        >
          <div className="mb-2 flex items-center gap-3">
            <span
              className="text-md font-semibold"
              style={{ color: borderColor }}
            >
              {utterance.speakerName}
            </span>
            <span className="text-xs text-gray-400">
              {formatTime(utterance.start)} - {formatTime(utterance.end)}
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto text-base leading-[1.7] text-gray-700" ref={textRef}>
            {utterance.text}
          </div>
        </div>
      </div>
    </div>
  );
}
