import type { ContentWarning } from '../../claude/claude-guard.utils';

/** 分析結果（1つの質問に対する回答） */
export interface AnalysisResult {
  /** 質問文 */
  question: string;
  /** 回答（Markdown形式） */
  answer: string;
  /** Web検索ソース */
  sources: { title: string; url: string }[];
}

/** 会話分析レスポンス全体 */
export interface InterviewAnalysis {
  /** 一意のID */
  id: string;
  /** 文字起こしID */
  transcriptionId: string;
  /** 話者ID */
  speakerId: string;
  /** 話者名 */
  speakerName: string;
  /** 分析に使用したキーワード */
  keywords: string[];
  /** 分析結果 */
  results: AnalysisResult[];
  /** 作成日時（ISO 8601） */
  createdAt: string;
  /** 使用したモデルID（以前のログにはない） */
  model?: string;
  /** Claude の応答に検出された不適切な表現（信頼度 MEDIUM 以上。以前のログにはない） */
  contentWarnings?: ContentWarning[];
}

/** 発言の文脈分析結果（1つの発話に対する分析） */
export interface UtteranceContextResult {
  /** 発話インデックス */
  utteranceIndex: number;
  /** 話者ID */
  speakerId: string;
  /** 話者名 */
  speakerName: string;
  /** 発話テキスト */
  text: string;
  /** 直前の発話（データから抽出） */
  previousUtterance: {
    speakerName: string;
    text: string;
  } | null;
  /** 発言の意図（LLMから） */
  intent: string;
  /** 話題（LLMから） */
  topic: string;
}

/** 発言の文脈分析レスポンス全体 */
export interface ContextAnalysisResponse {
  /** 文字起こしID */
  transcriptionId: string;
  /** 分析結果 */
  results: UtteranceContextResult[];
  /** 使用したモデルID */
  model: string;
  /** Claude の応答に検出された不適切な表現（信頼度 MEDIUM 以上） */
  contentWarnings: ContentWarning[];
}

/** 要約の要点の根拠（会話から抜き出した発言。会話に実際にあることを確かめたものだけ） */
export interface SummaryEvidence {
  /** 引用した文字列 */
  quote: string;
  /** 引用を含む発言の番号 */
  utteranceIndex: number;
  /** 話者名 */
  speakerName: string;
  /** 発言の開始時間（秒） */
  start: number;
}

/** 要約のキーポイント */
export interface SummaryKeyPoint {
  /** トピック名 */
  topic: string;
  /** 要点（2〜3文） */
  summary: string;
  /** 要点の根拠（以前のログと、根拠を求めないプロンプトの場合はない） */
  evidence?: SummaryEvidence[];
}

/** 要約結果 */
export interface TranscriptionSummaryLog {
  /** 一意のID */
  id: string;
  /** 文字起こしID */
  transcriptionId: string;
  /** 会話全体の概要（2〜3文）。プロンプトで除外された場合は undefined */
  overview?: string;
  /** キーポイント（トピック＋要点のペア）。プロンプトで除外された場合は undefined */
  key_points?: SummaryKeyPoint[];
  /** 決定事項。プロンプトで除外された場合は undefined */
  decisions?: string[];
  /** 作成日時（ISO 8601） */
  createdAt: string;
  /** 使用したモデルID */
  model: string;
  /** 実際に使用したプロンプト */
  prompt: string;
  /** 会話に見つからなかったため除いた根拠の数（以前のログにはない） */
  droppedEvidenceCount?: number;
  /** Claude の応答に検出された不適切な表現（信頼度 MEDIUM 以上。以前のログにはない） */
  contentWarnings?: ContentWarning[];
}
