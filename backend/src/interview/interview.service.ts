import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeService } from './claude.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { InterviewAnalysis } from './types/interview.types';

/** インタビュー分析のビジネスロジックを担当するサービス */
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
}
