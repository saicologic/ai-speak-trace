import { Injectable, Logger } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';
import { AnalysisResult } from '../interview/types/interview.types';

/** 会話分析・Web検索・ディープサーチ分析を担うサービス */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(private readonly claudeClient: ClaudeClientService) {}

  /** 質問生成プロンプトを構築 */
  buildGenerateQuestionsPrompt(
    keywords: string[],
    speakerName: string,
  ): string {
    const keywordContext = keywords.map((kw) => `- 「${kw}」`).join('\n');

    return `「${speakerName}」が話題にした以下のキーワードについて、調査質問を生成してください。

## 対象キーワード
${keywordContext}

## 指示
- 各キーワードについて1〜2件の質問を生成してください
- 質問はそのキーワード固有の内容にしてください（他のキーワードと混ぜない）
- 質問文は「〜について教えてください」「〜の最新動向は？」のような調査レポート向けの形式にしてください
- 質問の先頭に【キーワード名】を付けてください（例: 【富岳LLM】富岳LLMの性能ベンチマーク結果について教えてください）
- 1行に1つの質問を書いてください
- 質問文のみを出力してください（説明や前置きは不要）`;
  }

  /** 分析プロンプトを構築（1つの質問分） */
  buildAnalysisPrompt(
    question: string,
    keywords: string[],
    speakerName: string,
  ): string {
    return `「${speakerName}」が話題にしたキーワード（${keywords.join('、')}）に関連する以下の質問について、Web検索を使って調査し、回答してください。

## 質問
${question}

## 回答形式
- Markdown形式で回答してください
- 調査結果を簡潔にまとめてください（300〜500文字程度）`;
  }

  /** 発言の文脈分析プロンプトを構築 */
  buildContextAnalysisPrompt(
    allUtterances: { speakerName: string; text: string }[],
    targetIndices: number[],
  ): string {
    const conversationLines = allUtterances
      .map((u, i) => `[${i}] ${u.speakerName}: ${u.text}`)
      .join('\n');

    const targetList = targetIndices.join(', ');

    return `以下の会話の文字起こしから、指定された発話の文脈を分析してください。

## 会話全文
${conversationLines}

## 分析対象の発話番号
${targetList}

## 指示
上記の発話番号に該当する各発話について、以下の2項目を分析してください:
- 「intent」: 発言の意図（以下のいずれか: 質問, 回答, 同意, 反論, 補足, 提案, 説明, 感想, 挨拶, その他）
- 「topic」: その発話の話題を10〜30文字程度で簡潔に記述

## 出力形式
以下のJSON配列のみを出力してください。JSON以外は出力しないでください。
[
  { "index": 0, "intent": "質問", "topic": "プロジェクトの進捗状況" }
]`;
  }

  /** キーワードから調査レポート用の質問文を生成 */
  async generateQuestions(
    keywords: string[],
    speakerName: string,
  ): Promise<string[]> {
    this.logger.log(`質問生成開始: キーワード数=${keywords.length}`);

    const prompt = this.buildGenerateQuestionsPrompt(keywords, speakerName);

    const response = await this.claudeClient.getClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
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

  /** 質問文でWeb検索付き分析を実行 */
  async analyze(
    questions: string[],
    keywords: string[],
    speakerName: string,
  ): Promise<AnalysisResult[]> {
    this.logger.log(`分析開始: 質問数=${questions.length}`);

    const results: AnalysisResult[] = [];

    for (const question of questions) {
      try {
        const result = await this.analyzeQuestion(question, keywords, speakerName);
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
    speakerName: string,
  ): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(question, keywords, speakerName);

    const response = await this.claudeClient.getClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    });

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

  /** 発言の文脈を分析 */
  async analyzeContext(
    allUtterances: { speakerName: string; text: string }[],
    targetIndices: number[],
  ): Promise<{ index: number; intent: string; topic: string }[]> {
    this.logger.log(`文脈分析開始: 対象=${targetIndices.length}件`);

    const prompt = this.buildContextAnalysisPrompt(allUtterances, targetIndices);

    const response = await this.claudeClient.getClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      this.logger.error('文脈分析のJSON抽出に失敗');
      throw new Error('文脈分析結果のパースに失敗しました');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      index: number;
      intent: string;
      topic: string;
    }[];

    this.logger.log(`文脈分析完了: ${parsed.length}件`);
    return parsed;
  }

  /** テキストをWeb検索で調査し、Markdown形式で回答を返す */
  async searchAndAnalyze(
    keywords: string[],
    context: string,
  ): Promise<{ answer: string; sources: { title: string; url: string }[] }> {
    const prompt = `以下のキーワードと文脈に基づいて、Web検索で調査し回答してください。

## キーワード
${keywords.map((kw) => `- ${kw}`).join('\n')}

## 文脈
${context}

## 回答形式
- Markdown形式で回答してください
- 調査結果を簡潔にまとめてください（300〜500文字程度）`;

    const response = await this.claudeClient.getClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    });

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

    return { answer, sources };
  }

  /** 検索結果をまとめて分析 */
  async analyzeSearchResults(
    keywords: string[],
    results: { sourceType: string; sourceName: string; text: string }[],
  ): Promise<string> {
    const resultsText = results
      .map((r, i) => `[${i + 1}] (${r.sourceType}) ${r.sourceName}\n${r.text}`)
      .join('\n\n');

    const prompt = `以下のキーワードに関連する検索結果を分析し、総合的なレポートを作成してください。

## キーワード
${keywords.map((kw) => `- ${kw}`).join('\n')}

## 検索結果
${resultsText}

## 指示
- 各ソース（会話、PDF、Web）の情報を総合してまとめてください
- 会話での議論内容とPDF資料の情報がどう関連するかを分析してください
- Markdown形式で構造化して出力してください
- 重要なポイントを箇条書きでまとめてください`;

    const response = await this.claudeClient.getClient().messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : '';
  }
}
