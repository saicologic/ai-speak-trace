/** 分析リクエストDTO */
export class AnalyzeDto {
  transcriptionId: string;
  speakerId: string;
  keywords: string[];
  questions: string[];
}
