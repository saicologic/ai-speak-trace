/** ディープサーチリクエストDTO */
export class DeepSearchDto {
  /** 検索キーワード */
  keywords: string[];

  /** 対象の文字起こしID */
  transcriptionIds: string[];

  /** PDF検索を含めるか */
  includePdfs: boolean;

  /** Web検索を含めるか */
  includeWeb: boolean;
}

/** ディープサーチ分析リクエストDTO */
export class DeepSearchAnalyzeDto {
  /** 検索キーワード */
  keywords: string[];

  /** 分析対象の検索結果 */
  results: {
    sourceType: string;
    sourceName: string;
    text: string;
    url?: string;
  }[];
}
