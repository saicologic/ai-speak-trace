import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AnalysisResult } from './types/interview.types';

/** Claude API連携サービス */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  /** キーワードと発話テキストから調査レポート用の質問文を生成 */
  async generateQuestions(
    keywords: string[],
    speakerUtterances: string,
    speakerName: string,
  ): Promise<string[]> {
    this.logger.log(`質問生成開始: キーワード数=${keywords.length}`);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `以下は「${speakerName}」の会話内容です。この話者の興味・関心の傾向を深掘りするための調査質問を生成してください。

## 会話内容
${speakerUtterances}

## 抽出されたキーワード
${keywords.join('、')}

## 指示
- キーワードを元に、Web検索で調査するための質問文を5〜8件生成してください
- 各質問は、話者が関心を持っているトピックについて深掘りする内容にしてください
- 質問文は「〜について教えてください」「〜の最新動向は？」のような調査レポート向けの形式にしてください
- 1行に1つの質問を書き、番号を付けないでください
- 質問文のみを出力してください（説明や前置きは不要）`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const questions = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    this.logger.log(`質問生成完了: ${questions.length}件`);
    return questions;
  }

  /** 質問文と文字起こしコンテキストでWeb検索付き分析を実行 */
  async analyze(
    questions: string[],
    keywords: string[],
    speakerUtterances: string,
    speakerName: string,
  ): Promise<AnalysisResult[]> {
    this.logger.log(`分析開始: 質問数=${questions.length}`);

    const results: AnalysisResult[] = [];

    for (const question of questions) {
      try {
        const result = await this.analyzeQuestion(
          question,
          keywords,
          speakerUtterances,
          speakerName,
        );
        results.push(result);
      } catch (error) {
        this.logger.error(`質問の分析に失敗: ${question}`, error);
        results.push({
          question,
          answer: '分析中にエラーが発生しました。',
          sources: [],
        });
      }
    }

    this.logger.log(`分析完了: ${results.length}件`);
    return results;
  }

  /** 1つの質問に対してWeb検索付き分析を実行 */
  private async analyzeQuestion(
    question: string,
    keywords: string[],
    speakerUtterances: string,
    speakerName: string,
  ): Promise<AnalysisResult> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `以下の会話で「${speakerName}」が話題にしたキーワード（${keywords.join('、')}）に関連する質問について、Web検索を使って調査し、回答してください。

## 会話コンテキスト（${speakerName}の発話）
${speakerUtterances.slice(0, 2000)}

## 質問
${question}

## 回答形式
- Markdown形式で回答してください
- 調査結果を簡潔にまとめてください（300〜500文字程度）
- 話者の興味・関心との関連性も言及してください`,
        },
      ],
    });

    // レスポンスからテキストとソースURLを抽出
    let answer = '';
    const sources: { title: string; url: string }[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        answer += block.text;
      }
      if (block.type === 'web_search_tool_result') {
        for (const searchResult of (block as any).content || []) {
          if (searchResult.type === 'web_search_result') {
            sources.push({
              title: searchResult.title || searchResult.url,
              url: searchResult.url,
            });
          }
        }
      }
    }

    return { question, answer, sources };
  }
}
