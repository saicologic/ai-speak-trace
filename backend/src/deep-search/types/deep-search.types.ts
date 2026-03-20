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
  /** 関連度スコア（0-1、ベクトル検索の場合） */
  score?: number;
  /** 話者名（会話の場合） */
  speakerName?: string;
  /** Web検索のURL */
  url?: string;
}

/** ディープサーチのレスポンス */
export interface DeepSearchResponse {
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
