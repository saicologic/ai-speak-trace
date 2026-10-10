import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeClientService } from './claude-client.service';
import { AnalysisResult } from '../interview/types/interview.types';
import { assertCompleteResponse, extractText } from './claude-response.utils';

/** 会話分析・Web検索・ディープサーチ分析に使うClaudeモデル */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

/** 思考の深さ（Sonnet 5.5 の既定は high。分析・要約用途のため medium に下げる） */
const CLAUDE_EFFORT = 'medium';

/** 出力の上限トークン数（思考のトークンも含まれるため余裕を持たせる） */
const MAX_TOKENS = 16000;

/** Web検索の1回のリクエストで pause_turn から再開する上限回数 */
const MAX_PAUSE_CONTINUATIONS = 3;

/**
 * Web検索ツールの版
 * - web_search_20260209: 検索結果をサーバー側のコード実行で絞り込む新しい版。回答に引用（citations）が付かない
 * - web_search_20250305: 従来版。回答の各文に引用が付く
 */
type WebSearchToolType = 'web_search_20260209' | 'web_search_20250305';

/** Web検索の参照元 */
export interface WebSource {
  title: string;
  url: string;
  /** 回答の根拠として引用された本文の抜粋（引用されなかった参照元は空配列） */
  excerpts: string[];
}

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

    const text = await this.createText(prompt);
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
        const result = await this.analyzeQuestion(
          question,
          keywords,
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
    speakerName: string,
  ): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(question, keywords, speakerName);

    const { answer, sources } = await this.createWithWebSearch(
      prompt,
      'web_search_20260209',
    );

    return { question, answer, sources };
  }

  /** 発言の文脈を分析 */
  async analyzeContext(
    allUtterances: { speakerName: string; text: string }[],
    targetIndices: number[],
  ): Promise<{ index: number; intent: string; topic: string }[]> {
    this.logger.log(`文脈分析開始: 対象=${targetIndices.length}件`);

    const prompt = this.buildContextAnalysisPrompt(
      allUtterances,
      targetIndices,
    );

    const text = await this.createText(prompt);

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
  ): Promise<{ answer: string; sources: WebSource[] }> {
    const prompt = `以下のキーワードと文脈に基づいて、Web検索で調査し回答してください。

## キーワード
${keywords.map((kw) => `- ${kw}`).join('\n')}

## 文脈
${context}

## 回答形式
- Markdown形式で回答してください
- 調査結果を簡潔にまとめてください（300〜500文字程度）`;

    // ディープサーチでは引用本文を検索結果として使うため、引用が付く従来版を使う
    const { answer, sources } = await this.createWithWebSearch(
      prompt,
      'web_search_20250305',
    );

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

    return this.createText(prompt);
  }

  /** Web検索なしでClaudeを呼び出し、テキストを返す */
  private async createText(prompt: string): Promise<string> {
    const response = await this.claudeClient.getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: CLAUDE_EFFORT },
      messages: [{ role: 'user', content: prompt }],
    });
    assertCompleteResponse(response);
    return extractText(response.content);
  }

  /** Web検索付きでClaudeを呼び出し、回答テキストと参照元を返す */
  private async createWithWebSearch(
    prompt: string,
    toolType: WebSearchToolType,
  ): Promise<{ answer: string; sources: WebSource[] }> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];
    const content: Anthropic.ContentBlock[] = [];
    // 回答テキストは最後（完了した）応答だけから取り出す。中断前の途中の文章を混ぜないため
    let finalContent: Anthropic.ContentBlock[] | null = null;

    // サーバー側ツールの実行が長引くと pause_turn で中断されるため、応答を履歴に足して再開する
    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const response = await this.claudeClient.getClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: CLAUDE_EFFORT },
        tools: [
          {
            type: toolType,
            name: 'web_search',
            max_uses: 3,
          },
        ],
        messages,
      });
      assertCompleteResponse(response);
      content.push(...response.content);
      if (response.stop_reason !== 'pause_turn') {
        finalContent = response.content;
        break;
      }
      messages.push({ role: 'assistant', content: response.content });
    }
    // 再開上限に達しても中断されたままの場合、途中までの回答を成功として返さない
    if (finalContent === null) {
      throw new Error('Web検索がpause_turnの再開上限に達しました');
    }

    // 検索でヒットした記事を URL ごとにまとめ、回答の引用（citations）から本文の抜粋を集める
    const sourcesByUrl = new Map<string, WebSource>();
    const getSource = (url: string, title: string | null): WebSource => {
      let source = sourcesByUrl.get(url);
      if (!source) {
        source = { title: title || url, url, excerpts: [] };
        sourcesByUrl.set(url, source);
      }
      return source;
    };
    for (const block of content) {
      if (
        block.type === 'web_search_tool_result' &&
        Array.isArray(block.content)
      ) {
        for (const searchResult of block.content) {
          getSource(searchResult.url, searchResult.title);
        }
      }
      if (block.type === 'text') {
        for (const citation of block.citations ?? []) {
          if (citation.type !== 'web_search_result_location') continue;
          const excerpt = citation.cited_text.trim();
          const source = getSource(citation.url, citation.title);
          // 空の抜粋を入れると「引用あり」と判定され、本文が空の結果になるため除外する
          if (excerpt && !source.excerpts.includes(excerpt)) {
            source.excerpts.push(excerpt);
          }
        }
      }
    }

    return {
      answer: extractText(finalContent),
      sources: Array.from(sourcesByUrl.values()),
    };
  }
}
