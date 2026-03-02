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
}
