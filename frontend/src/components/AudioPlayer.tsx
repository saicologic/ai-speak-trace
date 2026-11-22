import { forwardRef, useEffect, useState } from 'react';
import { fetchAudioFileUrl } from '../api/client';

interface Props {
  fileName: string;
  onJumpToUtterance?: () => void;
}

/** 音声と「会話にジャンプ」ボタンを横に並べる外枠（読み込み中も同じ余白をとる） */
const playerClass = 'mb-6 flex items-center gap-3';

/** 音声再生コンポーネント */
export const AudioPlayer = forwardRef<HTMLAudioElement, Props>(
  function AudioPlayer({ fileName, onJumpToUtterance }, ref) {
    const [audioUrl, setAudioUrl] = useState<string>('');

    useEffect(() => {
      fetchAudioFileUrl(fileName).then(setAudioUrl).catch(() => setAudioUrl(''));
    }, [fileName]);

    if (!audioUrl) {
      return <div className={playerClass}>読み込み中...</div>;
    }

    return (
      <div className={playerClass}>
        <audio className="flex-1 rounded-lg" controls src={audioUrl} ref={ref}>
          お使いのブラウザは音声再生に対応していません。
        </audio>
        {onJumpToUtterance && (
          <button
            className="size-[2.2rem] shrink-0 rounded-full border-gray-300 bg-transparent p-0 text-xl-minus leading-none hover:border-gray-400 hover:bg-gray-100"
            onClick={onJumpToUtterance}
            title="現在の再生位置に該当する会話にジャンプします"
          >
            🔍
          </button>
        )}
      </div>
    );
  },
);
