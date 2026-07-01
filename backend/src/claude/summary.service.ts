import { Injectable, Logger } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';

/** 会話要約を担うサービス */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  /** 要約プロンプトのデフォルトテンプレート（{{fullText}} を会話全文で置換して使う） */
  static readonly DEFAULT_SUMMARY_PROMPT = `あなたは会議・インタビューの文字起こしを要約するアシスタントです。

<conversation>
{{fullText}}
</conversation>

<instructions>
上記の会話を分析し、以下のJSON形式のみで出力してください。JSONの前後に説明文やコードブロック記号（\`\`\`）を含めないでください。

{
  "overview": "会話全体の概要を2〜3文で記述",
  "key_points": [
    { "topic": "トピック名", "summary": "要点を2〜3文で記述" }
  ],
  "decisions": ["決定事項1", "決定事項2"],
  "actions": [
    { "speaker": "話者名", "task": "タスク内容を動詞句で記述" }
  ],
  "open_questions": ["未解決の質問1", "未解決の質問2"]
}

- overview: 会話の目的・流れ・結果を第三者が読んで理解できるよう2〜3文でまとめる
- key_points: 会話で扱われた主なテーマを3〜5点。各トピックの要点を2〜3文で記述する
- decisions: 会話中に明示的に合意・決定された事項を列挙する。なければ空配列 []
- actions: 会話中に言及された次のステップを話者名と紐づけて列挙する。話者が不明な場合は「未定」とする。なければ空配列 []
- open_questions: 結論が出なかった質問・持ち越し事項を列挙する。なければ空配列 []
</instructions>`;

  /** 要約で選択可能なモデル一覧（要約向き順） */
  static readonly SUMMARY_MODELS = [
    { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6（推奨）' },
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'claude-haiku-4-5-20251001（高速・低コスト）',
    },
    { id: 'claude-opus-4-7', label: 'claude-opus-4-7（高品質）' },
  ];

  constructor(private readonly claudeClient: ClaudeClientService) {}

  /** 会話全文を要約してJSON構造で返す */
  async summarize(
    fullText: string,
    model: string = 'claude-sonnet-4-6',
    promptTemplate: string = SummaryService.DEFAULT_SUMMARY_PROMPT,
  ): Promise<{
    overview?: string;
    key_points?: { topic: string; summary: string }[];
    decisions?: string[];
    actions?: { speaker: string; task: string }[];
    open_questions?: string[];
  }> {
    this.logger.log(`要約開始: model=${model}`);

    const prompt = promptTemplate.replace('{{fullText}}', fullText);

    const response = await this.claudeClient.getClient().messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.error(`要約のJSON抽出に失敗。レスポンス: ${text.slice(0, 200)}`);
      throw new Error('要約結果のパースに失敗しました');
    }

    let parsed: {
      overview?: string;
      key_points?: { topic: string; summary: string }[];
      decisions?: string[];
      actions?: { speaker: string; task: string }[];
      open_questions?: string[];
    };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      this.logger.error(`要約JSONのパースに失敗。stop_reason=${response.stop_reason}、レスポンス末尾: ${text.slice(-200)}`);
      throw new Error('要約結果のパースに失敗しました。音声が長すぎる可能性があります。');
    }

    this.logger.log('要約完了');
    return parsed;
  }
}
