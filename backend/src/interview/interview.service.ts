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

  /** キーワードと話者情報から調査質問文を生成 */
  async generateQuestions(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
  ): Promise<string[]> {
    const transcription = await this.store.findById(transcriptionId);
    if (!transcription) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${transcriptionId}`,
      );
    }

    // 指定話者の発話テキストを抽出
    const speaker = transcription.speakers.find((s) => s.id === speakerId);
    const speakerName = speaker?.name ?? speakerId;
    const speakerUtterances = transcription.utterances
      .filter((u) => u.speakerId === speakerId)
      .map((u) => u.text)
      .join('\n');

    return this.claudeService.generateQuestions(
      keywords,
      speakerUtterances,
      speakerName,
    );
  }

  /** Web検索付き分析を実行 */
  async analyze(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
    questions: string[],
  ): Promise<InterviewAnalysis> {
    const transcription = await this.store.findById(transcriptionId);
    if (!transcription) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${transcriptionId}`,
      );
    }

    const speaker = transcription.speakers.find((s) => s.id === speakerId);
    const speakerName = speaker?.name ?? speakerId;
    const speakerUtterances = transcription.utterances
      .filter((u) => u.speakerId === speakerId)
      .map((u) => u.text)
      .join('\n');

    this.logger.log(
      `分析開始: ${speakerName}, キーワード=${keywords.length}件, 質問=${questions.length}件`,
    );

    const results = await this.claudeService.analyze(
      questions,
      keywords,
      speakerUtterances,
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
