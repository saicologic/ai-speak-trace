/** 発言の文脈分析リクエストDTO */
export class AnalyzeContextDto {
  /** 文字起こしID */
  transcriptionId: string;
  /** 分析対象の発話インデックス（utterances配列のインデックス） */
  utteranceIndices: number[];
}
