import './AudioPlayer.css';

interface Props {
  fileName: string;
}

/** 音声再生コンポーネント */
export function AudioPlayer({ fileName }: Props) {
  return (
    <div className="audio-player">
      <audio controls src={`/outputs/${encodeURIComponent(fileName)}`}>
        お使いのブラウザは音声再生に対応していません。
      </audio>
    </div>
  );
}
