import { useEffect, useState } from 'react';
import { fetchAudioFileUrl } from '../api/client';
import './AudioPlayer.css';

interface Props {
  fileName: string;
}

/** 音声再生コンポーネント */
export function AudioPlayer({ fileName }: Props) {
  const [audioUrl, setAudioUrl] = useState<string>('');

  useEffect(() => {
    fetchAudioFileUrl(fileName).then(setAudioUrl).catch(() => setAudioUrl(''));
  }, [fileName]);

  if (!audioUrl) {
    return <div className="audio-player">読み込み中...</div>;
  }

  return (
    <div className="audio-player">
      <audio controls src={audioUrl}>
        お使いのブラウザは音声再生に対応していません。
      </audio>
    </div>
  );
}
