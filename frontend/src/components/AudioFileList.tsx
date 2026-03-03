import { useEffect, useRef, useState } from 'react';
import { fetchAudioFiles, uploadAudioFile } from '../api/client';
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    try {
      setFetchError(null);
      const result = await fetchAudioFiles();
      setFiles(result);
    } catch {
      setFiles([]);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setFetchError(null);
      await uploadAudioFile(file);
      await loadFiles();
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'アップロードに失敗しました',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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
          disabled={loading || uploading}
        >
          更新
        </button>
      </div>

      <div className="audio-file-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac,.mp4"
          onChange={handleUpload}
          disabled={loading || uploading}
          hidden
        />
        <button
          className="upload-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || uploading}
        >
          {uploading ? 'アップロード中...' : 'ファイルをアップロード'}
        </button>
      </div>

      {fetchError && (
        <div className="audio-file-list-error">{fetchError}</div>
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
