import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AnalysisService } from '../claude/analysis.service';
import { SummaryService } from '../claude/summary.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { AnalysisLogStorage, SummaryLogStorage } from './analysis-log.storage';
import {
  InterviewAnalysis,
  TranscriptionSummaryLog,
  UtteranceContextResult,
  ContextAnalysisResponse,
} from './types/interview.types';

/** 会話分析のビジネスロジックを担当するサービス */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly analysisService: AnalysisService,
    private readonly summaryService: SummaryService,
    private readonly store: TranscriptionStoreService,
    private readonly analysisLogStorage: AnalysisLogStorage,
    private readonly summaryLogStorage: SummaryLogStorage,
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
    conversationContext?: string,
  ): Promise<string[]> {
    const speakerName = await this.getSpeakerName(
      transcriptionId,
      speakerId,
    );

    return this.analysisService.generateQuestions(keywords, speakerName, conversationContext);
  }

  /** Web検索付き分析を実行 */
  async analyze(
    transcriptionId: string,
    speakerId: string,
    keywords: string[],
    questions: string[],
    conversationContext?: string,
  ): Promise<InterviewAnalysis> {
    const speakerName = await this.getSpeakerName(
      transcriptionId,
      speakerId,
    );

    this.logger.log(
      `分析開始: ${speakerName}, キーワード=${keywords.length}件, 質問=${questions.length}件`,
    );

    const results = await this.analysisService.analyze(
      questions,
      keywords,
      speakerName,
      conversationContext,
    );

    const analysis: InterviewAnalysis = {
      id: uuidv4(),
      transcriptionId,
      speakerId,
      speakerName,
      keywords,
      results,
      createdAt: new Date().toISOString(),
    };

    // 分析結果を過去ログとして保存
    await this.analysisLogStorage.save(analysis);

    return analysis;
  }

  /** 分析ログ一覧（サマリー）を取得 */
  async findAnalysisLogs(): Promise<Omit<InterviewAnalysis, 'results'>[]> {
    return this.analysisLogStorage.findAllSummaries();
  }

  /** 分析ログ詳細を取得 */
  async findAnalysisLogById(id: string): Promise<InterviewAnalysis> {
    const log = await this.analysisLogStorage.findById(id);
    if (!log) {
      throw new NotFoundException(`分析ログが見つかりません: ${id}`);
    }
    return log;
  }

  /** 要約プロンプトのデフォルトテンプレートと選択可能なモデル一覧を返す */
  getSummaryConfig(): {
    defaultPrompt: string;
    models: { id: string; label: string }[];
  } {
    return {
      defaultPrompt: SummaryService.DEFAULT_SUMMARY_PROMPT,
      models: SummaryService.SUMMARY_MODELS,
    };
  }

  /** 要約を生成して保存 */
  async summarize(
    transcriptionId: string,
    model: string,
    promptTemplate: string,
  ): Promise<TranscriptionSummaryLog> {
    const transcription = await this.store.findById(transcriptionId);
    if (!transcription) {
      throw new NotFoundException(`文字起こし結果が見つかりません: ${transcriptionId}`);
    }

    this.logger.log(`要約開始: transcriptionId=${transcriptionId}, model=${model}`);
    const result = await this.summaryService.summarize(
      transcription.fullText,
      model,
      promptTemplate,
    );

    const summary: TranscriptionSummaryLog = {
      id: uuidv4(),
      transcriptionId,
      overview: result.overview,
      key_points: result.key_points,
      decisions: result.decisions,
      createdAt: new Date().toISOString(),
      model,
      prompt: promptTemplate,
    };


    await this.summaryLogStorage.save(summary);
    return summary;
  }

  /** 要約ログ一覧を取得 */
  async findSummaryLogs(): Promise<TranscriptionSummaryLog[]> {
    return this.summaryLogStorage.findAll();
  }

  /** 要約ログ詳細を取得 */
  async findSummaryLogById(id: string): Promise<TranscriptionSummaryLog> {
    const log = await this.summaryLogStorage.findById(id);
    if (!log) {
      throw new NotFoundException(`要約ログが見つかりません: ${id}`);
    }
    return log;
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
    const llmResults = await this.analysisService.analyzeContext(
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

  /** Ragas評価用データをエクスポート */
  async exportForRagas(logId: string): Promise<{
    samples: { question: string; answer: string; contexts: string[] }[];
  }> {
    const log = await this.analysisLogStorage.findById(logId);
    if (!log) {
      throw new NotFoundException(`分析ログが見つかりません: ${logId}`);
    }

    const samples = log.results.map((r) => ({
      question: r.question,
      answer: r.answer,
      contexts: r.sources.map((s) => s.url),
    }));

    return { samples };
  }
}
