import { Injectable, Logger } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';
import { ContentWarning } from './claude-guard.utils';
import { assertCompleteResponse, extractText } from './claude-response.utils';

/** Claude が返す要約の形 */
export interface SummaryOutput {
  overview?: string;
  key_points?: { topic: string; summary: string; evidence?: string[] }[];
  decisions?: string[];
}

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
    { "topic": "トピック名", "summary": "要点を2〜3文で記述", "evidence": ["根拠の発言の引用"] }
  ],
  "decisions": ["決定事項1", "決定事項2"]
}

- overview: 会話の目的・流れ・結果を第三者が読んで理解できるよう2〜3文でまとめる
- key_points: 会話で扱われた主なテーマを3〜5点。各トピックの要点を2〜3文で記述する
- evidence: 各トピックの要点の根拠になる発言を、会話から一字一句そのまま1〜2個抜き出す（各10〜60文字）
- decisions: 会話中に明示的に合意・決定された事項を列挙する。なければ空配列 []
</instructions>`;

  /** 要約で選択可能なモデル一覧（要約向き順） */
  static readonly SUMMARY_MODELS = [
    { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5（推奨）' },
    { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5（高速・低コスト）' },
    { id: 'claude-opus-5-5', label: 'claude-opus-5-5（高品質）' },
  ];

  constructor(private readonly claudeClient: ClaudeClientService) {}

  /** 会話全文を要約してJSON構造で返す */
  async summarize(
    fullText: string,
    model: string = 'claude-sonnet-5-5',
    promptTemplate: string = SummaryService.DEFAULT_SUMMARY_PROMPT,
  ): Promise<{ summary: SummaryOutput; warnings: ContentWarning[] }> {
    this.logger.log(`要約開始: model=${model}`);

    const prompt = promptTemplate.replace('{{fullText}}', () => fullText);

    const { message: response, warnings } =
      await this.claudeClient.createMessageWithReport(
        {
          model,
          // 思考のトークンも上限に含まれるため余裕を持たせる
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          messages: [{ role: 'user', content: prompt }],
        },
        // プロンプト攻撃は、埋め込んだ会話の全文だけで確認する
        { purpose: 'summary', untrusted: [fullText] },
      );
    assertCompleteResponse(response);

    const text = extractText(response.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.error(`要約のJSON抽出に失敗。レスポンス: ${text.slice(0, 200)}`);
      throw new Error('要約結果のパースに失敗しました');
    }

    let parsed: SummaryOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      this.logger.error(`要約JSONのパースに失敗。stop_reason=${response.stop_reason}、レスポンス末尾: ${text.slice(-200)}`);
      throw new Error('要約結果のパースに失敗しました。音声が長すぎる可能性があります。');
    }

    this.logger.log('要約完了');
    return { summary: parsed, warnings };
  }
}
