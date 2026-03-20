import { useEffect, useRef, useState } from 'react';
import {
  fetchDocuments,
  uploadDocument,
  fetchDocumentStatus,
  deleteDocument,
} from '../api/client';
import type { DocumentInfo } from '../types';
import './PDFList.css';

/** ファイルサイズを読みやすい形式に変換 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ステータスの日本語表示 */
function statusLabel(
  status: DocumentInfo['status'],
): string {
  switch (status) {
    case 'uploading':
      return 'アップロード中';
    case 'processing':
      return '処理中';
    case 'searchable':
      return '検索可能';
    case 'error':
      return 'エラー';
  }
}

/** PDF資料管理コンポーネント（左サイドバー） */
export function PDFList() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 一覧をロード */
  const loadDocuments = async () => {
    try {
      setError(null);
      const result = await fetchDocuments();
      setDocuments(result);
    } catch {
      setDocuments([]);
    }
  };

  /** 初回ロード */
  useEffect(() => {
    loadDocuments();
  }, []);

  /** 処理中のドキュメントをポーリング */
  useEffect(() => {
    const processingDocs = documents.filter(
      (d) => d.status === 'processing',
    );
    if (processingDocs.length === 0) return;

    const interval = setInterval(async () => {
      for (const doc of processingDocs) {
        try {
          const updated = await fetchDocumentStatus(doc.id);
          setDocuments((prev) =>
            prev.map((d) => (d.id === updated.id ? updated : d)),
          );
        } catch {
          // ポーリング失敗は無視
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [documents]);

  /** ファイルアップロード */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      await uploadDocument(file);
      await loadDocuments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'アップロードに失敗しました',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  /** ドキュメント削除 */
  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '削除に失敗しました',
      );
    }
  };

  return (
    <div className="pdf-list">
      <div className="pdf-list-header">
        <h2>PDF資料</h2>
        <button className="reload-button" onClick={loadDocuments}>
          更新
        </button>
      </div>

      <div className="pdf-list-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleUpload}
          disabled={uploading}
          hidden
        />
        <button
          className="upload-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'アップロード中...' : 'PDFをアップロード'}
        </button>
      </div>

      {error && <div className="pdf-list-error">{error}</div>}

      <ul className="pdf-list-items">
        {documents.map((doc) => (
          <li key={doc.id} className="pdf-list-item">
            <div className="pdf-item-info">
              <span className="pdf-item-name" title={doc.fileName}>
                {doc.fileName}
              </span>
              <div className="pdf-item-meta">
                <span className="pdf-item-size">
                  {formatFileSize(doc.sizeBytes)}
                </span>
                <span
                  className={`pdf-item-status pdf-status-${doc.status}`}
                >
                  {statusLabel(doc.status)}
                </span>
              </div>
              {doc.status === 'error' && doc.errorMessage && (
                <span className="pdf-item-error">{doc.errorMessage}</span>
              )}
            </div>
            <button
              className="pdf-item-delete"
              onClick={() => handleDelete(doc.id)}
              title="削除"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {documents.length === 0 && (
        <p className="pdf-list-empty">
          PDF資料がありません
        </p>
      )}
    </div>
  );
}
