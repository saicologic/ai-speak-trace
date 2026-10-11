/** 話者情報 */
export interface Speaker {
  id: string;
  name: string;
  color: string;
}

/** 単語データ */
export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  type: 'word' | 'spacing' | 'audio_event';
  speakerId: string;
}

/** 発話セグメント */
export interface Utterance {
  speakerId: string;
  speakerName: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
}

/** 文字起こし結果 */
export interface Transcription {
  id: string;
  audioFileName: string;
  createdAt: string;
  languageCode: string;
  fullText: string;
  speakers: Speaker[];
  words: TranscriptionWord[];
  utterances: Utterance[];
}

/** 音声ファイル情報 */
export interface AudioFileInfo {
  fileName: string;
  sizeBytes: number;
  lastModified: string;
}

/** 文字起こしサマリー（一覧表示用） */
export interface TranscriptionSummary {
  id: string;
  audioFileName: string;
  createdAt: string;
}

/** キーワード（専門用語） */
export interface Keyword {
  text: string;
  count: number;
}

/** 分析結果（1つの質問に対する回答） */
export interface AnalysisResult {
  question: string;
  answer: string;
  sources: { title: string; url: string }[];
}

/** 会話分析レスポンス */
export interface InterviewAnalysis {
  id: string;
  transcriptionId: string;
  speakerId: string;
  speakerName: string;
  keywords: string[];
  results: AnalysisResult[];
  createdAt: string;
}

/** 発言の文脈分析結果（1つの発話） */
export interface UtteranceContextResult {
  utteranceIndex: number;
  speakerId: string;
  speakerName: string;
  text: string;
  previousUtterance: {
    speakerName: string;
    text: string;
  } | null;
  intent: string;
  topic: string;
}

/** 発言の文脈分析レスポンス */
export interface ContextAnalysisResponse {
  transcriptionId: string;
  results: UtteranceContextResult[];
}

/** PDFドキュメント情報 */
export interface DocumentInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: 'uploading' | 'processing' | 'searchable' | 'error';
  chunkCount: number;
  errorMessage?: string;
  createdAt: string;
  processedAt?: string;
}

/** 会話分析ログサマリー（results を除いた一覧表示用） */
export type InterviewAnalysisSummary = Omit<InterviewAnalysis, 'results'>;

/** 要約のキーポイント */
export interface SummaryKeyPoint {
  topic: string;
  summary: string;
}

/** 要約ログ */
export interface TranscriptionSummaryLog {
  id: string;
  transcriptionId: string;
  overview?: string;
  key_points?: SummaryKeyPoint[];
  decisions?: string[];
  createdAt: string;
  model: string;
  prompt: string;
}

/** 要約設定（デフォルトプロンプト・モデル一覧） */
export interface SummaryConfig {
  defaultPrompt: string;
  models: { id: string; label: string }[];
}

/** アプリ設定 */
export interface AppSettings {
  appVersion: string;
  storageType: string;
  paths: {
    dataDir: string;
    audioDir: string;
    transcriptionsDir: string;
    documentsDir: string;
    documentMetadataDir: string;
    summaryLogsDir: string;
  };
  apiKeys: {
    elevenlabsApiKey: string;
    anthropicApiKey: string;
  };
  enableDeepSearch: boolean;
  enableContextAnalysis: boolean;
  /** 個人情報チェックに使う Amazon Bedrock Guardrails */
  guardrail?: {
    id: string;
    version: string;
  };
}

/** 会話から検出した個人情報（同じ種類・同じ文字列ごとにまとめたもの） */
export interface PiiFinding {
  type: string;
  /** 表示名（氏名・電話番号など） */
  label: string;
  text: string;
  /** 会話に出てくる回数 */
  count: number;
  /** Claude などに送るときに伏せるか */
  mask: boolean;
  /** 利用者がまだ確認していないか（誤検出の多い氏名などは、確認するまで伏せない） */
  needsReview: boolean;
}

/** 文字起こしの個人情報チェックの状態 */
export interface PrivacyStatus {
  /** Guardrail ID が設定されているか */
  configured: boolean;
  scanning: boolean;
  error?: string;
  scan: {
    transcriptionId: string;
    scannedAt: string;
    guardrailId: string;
    guardrailVersion: string;
    findings: PiiFinding[];
  } | null;
}
