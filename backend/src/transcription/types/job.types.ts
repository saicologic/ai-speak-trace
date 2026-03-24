/** ジョブのステータス */
export type JobStatus = 'processing' | 'completed' | 'failed';

/** 文字起こしジョブ */
export interface TranscriptionJob {
  id: string;
  audioFileName: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  /** 完了時のTranscription ID */
  transcriptionId?: string;
  /** エラーメッセージ */
  errorMessage?: string;
}
