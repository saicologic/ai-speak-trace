import { useState } from 'react';
import { UtteranceBlock } from './UtteranceBlock';
import type { Transcription } from '../types';
import './TranscriptionView.css';

interface Props {
  transcription: Transcription;
}

/** 文字起こし結果表示コンポーネント */
export function TranscriptionView({ transcription }: Props) {
  const [selectedWords, setSelectedWords] = useState<Set<number>>(new Set());

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

  // 各utteranceのword開始インデックスを計算
  let wordOffset = 0;

  return (
    <div className="transcription-view">
      <h3>文字起こし結果</h3>

      {selectedWords.size > 0 && (
        <div className="selection-info">
          <span>{selectedWords.size} 単語を選択中</span>
          <button onClick={() => setSelectedWords(new Set())}>
            選択解除
          </button>
        </div>
      )}

      <div className="utterance-list">
        {transcription.utterances.map((utterance, i) => {
          const currentOffset = wordOffset;
          wordOffset += utterance.words.length;
          const speaker = transcription.speakers.find(
            (s) => s.id === utterance.speakerId,
          );

          return (
            <UtteranceBlock
              key={i}
              utterance={utterance}
              speaker={speaker}
              selectedWords={selectedWords}
              wordIndexOffset={currentOffset}
              onWordClick={toggleWord}
            />
          );
        })}
      </div>
    </div>
  );
}
