import { useEffect, useRef, useState } from 'react';
import { fetchAudioFiles, uploadAudioFile } from '../api/client';
import type { AudioFileInfo } from '../types';

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

/** 音声ファイルの項目：選んだ項目は青い枠にし、カーソルを乗せても色を変えない */
const itemClass = 'flex w-full flex-col gap-[0.15rem] rounded-lg border px-3 py-[0.6rem] text-left transition-all duration-150';
const selectedItemClass = 'border-blue-500 bg-blue-50';
const unselectedItemClass = 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50';

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
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">音声ファイル</h2>
        <button
          className="px-[0.6em] py-[0.3em] text-xs"
          onClick={loadFiles}
          disabled={loading || uploading}
        >
          更新
        </button>
      </div>

      <div className="mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac,.mp4"
          onChange={handleUpload}
          disabled={loading || uploading}
          hidden
        />
        <button
          className="w-full rounded-lg border-none bg-primary p-2 text-md font-medium text-white transition-colors duration-150 enabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-blue-300"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || uploading}
        >
          {uploading ? 'アップロード中...' : 'ファイルをアップロード'}
        </button>
      </div>

      {fetchError && (
        <div className="mb-2 rounded-md bg-red-50 p-2 text-sm text-red-800">{fetchError}</div>
      )}

      <ul className="list-none">
        {files.map((file) => (
          <li key={file.fileName} className="mb-1">
            <button
              className={`${itemClass} ${selectedFile === file.fileName ? selectedItemClass : unselectedItemClass}`}
              onClick={() => onFileSelect(file.fileName)}
              disabled={loading}
            >
              <span className="text-md font-medium break-all">{file.fileName}</span>
              <span className="text-xs text-gray-400">
                {formatFileSize(file.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
