import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeService } from './claude.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import {
  InterviewAnalysis,
  UtteranceContextResult,
  ContextAnalysisResponse,
} from './types/interview.types';

/** 会話分析のビジネスロジックを担当するサービス */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly store: TranscriptionStoreService,
  ) {}

  /** 話者名を取得するヘルパー */
  private async getSpeakerName(
    transcriptionId: string,
    speakerId: string,
  ): Promise<string> {
    const transcription = await this.store.findById(transcriptionId);
    if (!transcription) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${transcriptionId}`,
      );
    }
    const speaker = transcription.speakers.find((s) => s.id === speakerId);
    return speaker?.name ?? speakerId;
  }

  /** キーワードと話者情報から調査質問文を生成 */
  async generateQuestions(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
  ): Promise<string[]> {
    const speakerName = await this.getSpeakerName(
      transcriptionId,
      speakerId,
    );

    return this.claudeService.generateQuestions(keywords, speakerName);
  }

  /** プロンプトのプレビューを返す */
  async previewPrompts(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
    questions: string[],
  ): Promise<{ generateQuestionsPrompt: string; analyzePrompts: string[] }> {
    const speakerName = await this.getSpeakerName(
      transcriptionId,
      speakerId,
    );

    const generateQuestionsPrompt =
      this.claudeService.buildGenerateQuestionsPrompt(keywords, speakerName);

    const analyzePrompts = questions.map((q) =>
      this.claudeService.buildAnalysisPrompt(q, keywords, speakerName),
    );

    return { generateQuestionsPrompt, analyzePrompts };
  }

  /** Web検索付き分析を実行 */
  async analyze(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
    questions: string[],
  ): Promise<InterviewAnalysis> {
    const speakerName = await this.getSpeakerName(
      transcriptionId,
      speakerId,
    );

    this.logger.log(
      `分析開始: ${speakerName}, キーワード=${keywords.length}件, 質問=${questions.length}件`,
    );

    const results = await this.claudeService.analyze(
      questions,
      keywords,
      speakerName,
    );

    return {
      id: uuidv4(),
      transcriptionId,
      speakerId,
      speakerName,
      keywords,
      results,
      createdAt: new Date().toISOString(),
    };
  }

  /** 発言の文脈を分析 */
  async analyzeContext(
    transcriptionId: string,
    utteranceIndices: number[],
  ): Promise<ContextAnalysisResponse> {
    const transcription = await this.store.findById(transcriptionId);
    if (!transcription) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${transcriptionId}`,
      );
    }

    this.logger.log(
      `文脈分析開始: transcriptionId=${transcriptionId}, 対象=${utteranceIndices.length}件`,
    );

    // 全発話を簡略化して渡す
    const allUtterances = transcription.utterances.map((u) => ({
      speakerName: u.speakerName,
      text: u.text,
    }));

    // Claude APIで意図・話題を分析
    const llmResults = await this.claudeService.analyzeContext(
      allUtterances,
      utteranceIndices,
    );

    // LLM結果をインデックスでマッピング
    const llmMap = new Map(llmResults.map((r) => [r.index, r]));

    // 結果を組み立て（直前の発話はデータから抽出）
    const results: UtteranceContextResult[] = utteranceIndices.map((idx) => {
      const utterance = transcription.utterances[idx];
      const llm = llmMap.get(idx);

      const previousUtterance =
        idx > 0
          ? {
              speakerName: transcription.utterances[idx - 1].speakerName,
              text: transcription.utterances[idx - 1].text,
            }
          : null;

      return {
        utteranceIndex: idx,
        speakerId: utterance.speakerId,
        speakerName: utterance.speakerName,
        text: utterance.text,
        previousUtterance,
        intent: llm?.intent ?? 'その他',
        topic: llm?.topic ?? '',
      };
    });

    return { transcriptionId, results };
  }
}
