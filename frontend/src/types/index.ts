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

/** キーワードの出し方（標準: 正規表現、GiNZA: 日本語の解析。ベータ機能） */
export type KeywordSource = 'standard' | 'ginza';

/** GiNZA の準備の状態 */
export interface GinzaStatus {
  state: 'unsupported' | 'not_installed' | 'installing' | 'ready' | 'error';
  /** 進み具合やエラーの説明 */
  message: string;
  versions?: Record<string, string>;
}

/** GiNZA で取り出したキーワード（会話全体と話者ごと） */
export interface GinzaKeywords {
  keywords: Keyword[];
  bySpeaker: Record<string, Keyword[]>;
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
  /** 使用したモデル（以前のログにはない） */
  model?: string;
  contentWarnings?: ContentWarning[];
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
  model: string;
  contentWarnings: ContentWarning[];
}

/** 会話分析ログサマリー（results を除いた一覧表示用） */
export type InterviewAnalysisSummary = Omit<InterviewAnalysis, 'results'>;

/** 要約の要点の根拠（会話にあることを確かめた発言の引用） */
export interface SummaryEvidence {
  quote: string;
  utteranceIndex: number;
  speakerName: string;
  /** 発言の開始時間（秒） */
  start: number;
}

/** 要約のキーポイント */
export interface SummaryKeyPoint {
  topic: string;
  summary: string;
  /** 根拠（以前の要約にはない） */
  evidence?: SummaryEvidence[];
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
  /** 会話に見つからなかったため除いた根拠の数 */
  droppedEvidenceCount?: number;
  contentWarnings?: ContentWarning[];
}

/** 要約設定（デフォルトプロンプト・モデル一覧） */
export interface SummaryConfig {
  defaultPrompt: string;
  models: { id: string; label: string }[];
}

/** アプリ設定 */
export interface AppSettings {
  appVersion: string;
  paths: {
    dataDir: string;
    audioDir: string;
    transcriptionsDir: string;
    summaryLogsDir: string;
  };
  /** API キーの状態（値そのものは返らない） */
  apiKeys: {
    elevenlabsApiKey: ApiKeyStatus;
    anthropicApiKey: ApiKeyStatus;
  };
  /** API キーの保存先（macOS ではキーチェーン） */
  apiKeyStorage: 'keychain' | 'file';
  enableDeepSearch: boolean;
  enableContextAnalysis: boolean;
  /** GiNZA のキーワード抽出（ベータ機能） */
  enableGinzaKeywords?: boolean;
  /** 個人情報チェックに使う Amazon Bedrock Guardrails */
  guardrail?: {
    id: string;
    /** 固定したバージョン（空の場合は DRAFT） */
    version: string;
  };
  /** AWS の認証情報に使う ~/.aws のプロファイル名（空の場合は default） */
  awsProfile?: string;
}

/** API キーの状態 */
export interface ApiKeyStatus {
  configured: boolean;
  /** 末尾4文字（短いキーは空） */
  last4: string;
}

/** Claude の応答に検出された不適切な表現（Guardrails のコンテンツフィルター。信頼度 MEDIUM 以上） */
export interface ContentWarning {
  type: string;
  confidence: string;
}

/** 誤りを報告する対象の機能 */
export type FeedbackFeature = 'summary' | 'analysis' | 'context' | 'research';

/** 誤りの報告の種類 */
export type FeedbackCategory =
  | 'factual_error'
  | 'unsupported'
  | 'personal_judgement'
  | 'inappropriate'
  | 'other';

/** AI が生成した結果への、誤りの報告（端末にだけ保存する） */
export interface Feedback {
  id: string;
  createdAt: string;
  feature: FeedbackFeature;
  targetId: string;
  transcriptionId: string;
  /** 結果を作った文字起こしのすべて（ディープサーチのように複数の会話を使う結果だけ） */
  transcriptionIds?: string[];
  category: FeedbackCategory;
  quote: string;
  comment: string;
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
