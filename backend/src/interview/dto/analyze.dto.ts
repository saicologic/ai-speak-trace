/** 分析リクエストDTO */
export class AnalyzeDto {
  transcriptionId: string;
  speakerId: string;
  keywords: string[];
  questions: string[];
  /** 選択キーワードを含む発話テキスト（会話の文脈） */
  conversationContext?: string;
}
