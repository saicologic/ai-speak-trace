/** 質問生成リクエストDTO */
export class GenerateQuestionsDto {
  transcriptionId: string;
  speakerId: string;
  keywords: string[];
  /** 選択キーワードを含む発話テキスト（会話の文脈） */
  conversationContext?: string;
}
