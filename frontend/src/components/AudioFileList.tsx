import { useEffect, useState } from 'react';
import { fetchAudioFiles } from '../api/client';
import type { AudioFileInfo } from '../types';
import './AudioFileList.css';

interface Props {
  selectedFile: string | null;
  onFileSelect: (fileName: string) => void;
  loading: boolean;
}

/** ファイルサイズを読みやすい形式に変換 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 音声ファイル一覧コンポーネント */
export function AudioFileList({ selectedFile, onFileSelect, loading }: Props) {
  const [files, setFiles] = useState<AudioFileInfo[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadFiles = async () => {
    try {
      setFetchError(null);
      const result = await fetchAudioFiles();
      setFiles(result);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : '取得に失敗しました');
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  return (
    <div className="audio-file-list">
      <div className="audio-file-list-header">
        <h2>音声ファイル</h2>
        <button
          className="reload-button"
          onClick={loadFiles}
          disabled={loading}
        >
          更新
        </button>
      </div>

      {fetchError && (
        <div className="audio-file-list-error">{fetchError}</div>
      )}

      {files.length === 0 && !fetchError && (
        <p className="audio-file-list-empty">
          音声ファイルがありません。<br />
          outputs/ フォルダにファイルを配置してください。
        </p>
      )}

      <ul className="audio-file-list-items">
        {files.map((file) => (
          <li key={file.fileName}>
            <button
              className={`audio-file-item ${selectedFile === file.fileName ? 'selected' : ''}`}
              onClick={() => onFileSelect(file.fileName)}
              disabled={loading}
            >
              <span className="audio-file-name">{file.fileName}</span>
              <span className="audio-file-size">
                {formatFileSize(file.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
