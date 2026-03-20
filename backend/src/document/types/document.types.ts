/** PDFドキュメントのメタデータ */
export interface DocumentMetadata {
  /** 一意のID */
  id: string;
  /** 元のファイル名 */
  fileName: string;
  /** ファイルサイズ（バイト） */
  sizeBytes: number;
  /** 処理ステータス */
  status: 'uploading' | 'processing' | 'searchable' | 'error';
  /** チャンク数 */
  chunkCount: number;
  /** エラーメッセージ（エラー時のみ） */
  errorMessage?: string;
  /** アップロード日時（ISO 8601） */
  createdAt: string;
  /** 処理完了日時（ISO 8601） */
  processedAt?: string;
}

/** PDFテキストのチャンク */
export interface DocumentChunk {
  /** チャンクID */
  id: string;
  /** ドキュメントID */
  documentId: string;
  /** チャンクのテキスト */
  text: string;
  /** ドキュメント内のチャンク番号（0始まり） */
  chunkIndex: number;
}

/** ベクトル検索結果 */
export interface VectorSearchResult {
  /** チャンクのテキスト */
  text: string;
  /** 類似度スコア */
  score: number;
  /** ドキュメントID */
  documentId: string;
  /** ドキュメントファイル名 */
  fileName: string;
  /** チャンクインデックス */
  chunkIndex: number;
}
