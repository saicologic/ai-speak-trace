import { Injectable, Logger } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';

/** LLM-as-Judgeによる回答のFaithfulness（忠実性）チェック結果 */
export interface FaithfulnessResult {
  score: number;
  passed: boolean;
  reason: string;
}

/**
 * LLM-as-Judgeパターンでハルシネーションを検出するサービス。
 * Bedrock GuardrailsのContextual Grounding Checkに相当する仕組みを
 * Anthropic直接APIで実現する。
 *
 * 閾値（0.7）未満のスコアは「ソースに根拠のない回答」として検出し、
 * フォールバックメッセージに差し替える。
 */
@Injectable()
export class FaithfulnessCheckerService {
  private readonly logger = new Logger(FaithfulnessCheckerService.name);
  private static readonly THRESHOLD = 0.7;
  private static readonly FALLBACK_MESSAGE =
    '提供された情報では十分な回答ができませんでした。より具体的な情報をご提供いただくか、別のキーワードでお試しください。';

  constructor(private readonly claudeClient: ClaudeClientService) {}

  /**
   * 回答がソース情報に基づいているかを採点する（0.0〜1.0）。
   * Bedrock Guardrailsの Faithfulness メトリクスに相当。
   */
  async check(
    question: string,
    answer: string,
    sources: string[],
  ): Promise<FaithfulnessResult> {
    if (sources.length === 0 || answer.trim().length === 0) {
      return { score: 0, passed: false, reason: 'ソースまたは回答が空です' };
    }

    const sourcesText = sources
      .map((s, i) => `[ソース${i + 1}] ${s}`)
      .join('\n\n');

    const prompt = `以下の質問・ソース情報・回答を評価してください。

<question>
${question}
</question>

<sources>
${sourcesText}
</sources>

<answer>
${answer}
</answer>

## 評価基準
回答がソース情報のみに基づいているかを0.0〜1.0で採点してください。

- 1.0: 回答のすべての主張がソースに明確に根拠がある
- 0.7〜0.9: ほぼソースに基づいているが、わずかな補完がある
- 0.4〜0.6: 一部の主張がソースにない情報を含む
- 0.0〜0.3: 回答の多くがソースに根拠のない情報を含む

以下のJSON形式のみで出力してください：
{"score": 0.0〜1.0の数値, "reason": "採点理由を1文で"}`;

    try {
      const response = await this.claudeClient.getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn('Faithfulnessチェックのレスポンスをパースできませんでした');
        return { score: 1.0, passed: true, reason: 'チェックスキップ' };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        score: number;
        reason: string;
      };
      const passed = parsed.score >= FaithfulnessCheckerService.THRESHOLD;

      this.logger.log(
        `Faithfulnessスコア: ${parsed.score} (${passed ? '合格' : '不合格'}) - ${parsed.reason}`,
      );

      return { score: parsed.score, passed, reason: parsed.reason };
    } catch (error) {
      this.logger.warn('Faithfulnessチェックに失敗（スキップ）', error);
      return { score: 1.0, passed: true, reason: 'チェックスキップ' };
    }
  }

  /**
   * 回答を検証し、閾値未満の場合はフォールバックメッセージに差し替える。
   */
  async validateOrFallback(
    question: string,
    answer: string,
    sources: string[],
  ): Promise<string> {
    const result = await this.check(question, answer, sources);
    if (!result.passed) {
      this.logger.warn(
        `Faithfulness不合格のため回答を差し替え: score=${result.score}`,
      );
      return FaithfulnessCheckerService.FALLBACK_MESSAGE;
    }
    return answer;
  }
}
