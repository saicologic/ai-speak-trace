import { ElevenLabsWord } from './elevenlabs.types';

/** チャンク分割文字起こしジョブの状態 */
export interface ChunkedTranscriptionJob {
  /** ジョブID */
  id: string;
  /** 元の音声ファイル名 */
  audioFileName: string;
  /** ジョブ開始日時 */
  createdAt: string;
  /** ジョブ状態 */
  status: 'initializing' | 'splitting' | 'transcribing' | 'merging' | 'completed' | 'failed';
  /** 音声ファイルの総秒数 */
  totalDurationSec: number;
  /** チャンクあたりの秒数（デフォルト600秒=10分） */
  chunkDurationSec: number;
  /** 全チャンク数 */
  totalChunks: number;
  /** 現在処理中のチャンクインデックス（0始まり） */
  currentChunkIndex: number;
  /** 完了済みチャンクの結果 */
  completedChunks: CompletedChunk[];
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
  /** 最終更新日時 */
  updatedAt: string;
  /** 完了後の文字起こしID */
  transcriptionId?: string;
}

/** 完了済みチャンクの結果 */
export interface CompletedChunk {
  /** チャンクインデックス（0始まり） */
  index: number;
  /** チャンクファイル名 */
  chunkFileName: string;
  /** チャンクの開始時間（元の音声における秒数） */
  startTimeSec: number;
  /** ElevenLabs transcription_id（非同期処理用） */
  transcription_id?: string;
  /** チャンクのステータス（processing/completed/error） */
  chunkStatus?: 'processing' | 'completed' | 'error';
  /** エラーメッセージ（チャンクエラー時） */
  chunkErrorMessage?: string;
  /** ElevenLabsレスポンスの words 配列（タイムスタンプ調整済み） */
  words: ElevenLabsWord[];
  /** ElevenLabsレスポンスの text */
  text: string;
  /** 言語コード */
  languageCode: string;
}
