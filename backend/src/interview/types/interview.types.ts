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
}

/** 要約結果 */
export interface TranscriptionSummaryLog {
  /** 一意のID */
  id: string;
  /** 文字起こしID */
  transcriptionId: string;
  /** 主なトピック */
  topics: string[];
  /** 結論・合意事項 */
  conclusion: string;
  /** 次のアクション（なければ空配列） */
  actions: string[];
  /** 作成日時（ISO 8601） */
  createdAt: string;
}
