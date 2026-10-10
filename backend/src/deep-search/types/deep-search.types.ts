/** 検索ソースの種類 */
export type SearchSourceType = 'conversation' | 'pdf' | 'web';

/** 個別の検索結果 */
export interface DeepSearchResultItem {
  /** ソース種類 */
  sourceType: SearchSourceType;
  /** ソース名（ファイル名やURL） */
  sourceName: string;
  /** ソースID（transcriptionIdやdocumentId） */
  sourceId: string;
  /** マッチしたテキスト */
  text: string;
  /** cosine類似度（1に近いほど関連が高い、ベクトル検索の場合） */
  score?: number;
  /** 話者名（会話の場合） */
  speakerName?: string;
  /** Web検索のURL */
  url?: string;
}

/** ディープサーチのレスポンス */
export interface DeepSearchResponse {
  /** 検索ログID（分析時に渡すと同じログに分析結果を記録する） */
  id: string;
  /** 検索キーワード */
  keywords: string[];
  /** 検索結果 */
  results: DeepSearchResultItem[];
  /** 検索日時 */
  searchedAt: string;
}

/** Claude分析付きレスポンス */
export interface DeepSearchAnalysis {
  /** 元の検索結果 */
  searchResults: DeepSearchResultItem[];
  /** Claude分析結果（Markdown） */
  analysis: string;
  /** 分析日時 */
  analyzedAt: string;
}

/** ディープサーチのログ（検索条件・結果・分析を1回の検索ごとに保存） */
export interface DeepSearchLog {
  /** ログID */
  id: string;
  /** 検索キーワード */
  keywords: string[];
  /** 対象の文字起こしID */
  transcriptionIds: string[];
  /** PDF検索を含めたか */
  includePdfs: boolean;
  /** Web検索を含めたか */
  includeWeb: boolean;
  /** Web検索に使ったClaudeモデル（Web検索をした場合のみ） */
  webSearchModel?: string;
  /** 検索結果 */
  results: DeepSearchResultItem[];
  /** 検索日時 */
  searchedAt: string;
  /** Claude分析（分析した場合のみ） */
  analysis?: {
    /** 分析結果（Markdown） */
    text: string;
    /** 分析に使ったClaudeモデル */
    model: string;
    /** 分析日時 */
    analyzedAt: string;
  };
}

/** ディープサーチログの一覧表示用サマリー（結果本文と分析本文を除く） */
export type DeepSearchLogSummary = Omit<
  DeepSearchLog,
  'results' | 'analysis'
> & {
  /** 検索結果の件数 */
  resultCount: number;
  /** 分析済みかどうか */
  analyzed: boolean;
};
