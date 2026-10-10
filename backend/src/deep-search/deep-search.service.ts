import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../document/embedding.service';
import { VectorSearchService } from '../document/vector-search.service';
import { AnalysisService, CLAUDE_MODEL } from '../claude/analysis.service';
import { DeepSearchLogStorage } from './deep-search-log.storage';
import { ConversationSearchService } from './conversation-search.service';
import { DeepSearchDto, DeepSearchAnalyzeDto } from './dto/deep-search.dto';
import {
  DeepSearchResponse,
  DeepSearchResultItem,
  DeepSearchAnalysis,
  DeepSearchLog,
} from './types/deep-search.types';

/** PDF検索結果として採用するcosine類似度の下限の既定値 */
export const DEFAULT_MIN_PDF_SIMILARITY = 0.3;

/** 会話・PDF・Webを横断検索するサービス */
@Injectable()
export class DeepSearchService {
  private readonly logger = new Logger(DeepSearchService.name);
  /** PDF検索結果として採用するcosine類似度の下限 */
  private readonly minPdfSimilarity: number;

  constructor(
    private readonly conversationSearch: ConversationSearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly analysisService: AnalysisService,
    private readonly logStorage: DeepSearchLogStorage,
    private readonly configService: ConfigService,
  ) {
    this.minPdfSimilarity = this.resolveMinPdfSimilarity(
      this.configService.get<string>('DEEP_SEARCH_MIN_SIMILARITY'),
    );
  }

  /** 環境変数からcosine類似度の下限を決定する（不正値は既定値にフォールバック） */
  private resolveMinPdfSimilarity(raw: string | undefined): number {
    if (!raw) {
      return DEFAULT_MIN_PDF_SIMILARITY;
    }
    const configured = Number(raw);
    // cosine類似度は-1〜1の範囲のため、範囲外の値は設定ミスとみなす
    if (!Number.isFinite(configured) || configured < -1 || configured > 1) {
      this.logger.warn(
        `DEEP_SEARCH_MIN_SIMILARITY=${raw} は不正な値です（-1〜1の数値を指定してください）。既定値 ${DEFAULT_MIN_PDF_SIMILARITY} を使用します`,
      );
      return DEFAULT_MIN_PDF_SIMILARITY;
    }
    return configured;
  }

  /** ディープサーチ実行（3ソース横断） */
  async search(dto: DeepSearchDto): Promise<DeepSearchResponse> {
    this.logger.log(
      `ディープサーチ開始: keywords=${dto.keywords.join(',')}, transcriptions=${dto.transcriptionIds.length}件`,
    );

    // 各検索を並列実行
    const promises: Promise<DeepSearchResultItem[]>[] = [];

    if (dto.transcriptionIds.length > 0) {
      promises.push(
        this.conversationSearch.search(dto.keywords, dto.transcriptionIds),
      );
    }
    if (dto.includePdfs) {
      promises.push(this.searchPdfs(dto.keywords));
    }
    if (dto.includeWeb) {
      promises.push(this.searchWeb(dto.keywords));
    }

    const resultsArrays = await Promise.all(promises);
    const results = resultsArrays.flat();

    this.logger.log(`ディープサーチ完了: ${results.length}件`);

    const log: DeepSearchLog = {
      id: uuidv4(),
      keywords: dto.keywords,
      transcriptionIds: dto.transcriptionIds,
      includePdfs: dto.includePdfs,
      includeWeb: dto.includeWeb,
      ...(dto.includeWeb && { webSearchModel: CLAUDE_MODEL }),
      results,
      searchedAt: new Date().toISOString(),
    };
    await this.saveLog(log);

    return {
      id: log.id,
      keywords: log.keywords,
      results: log.results,
      searchedAt: log.searchedAt,
    };
  }

  /** 検索結果をClaude分析 */
  async analyzeResults(dto: DeepSearchAnalyzeDto): Promise<DeepSearchAnalysis> {
    this.logger.log(
      `ディープサーチ分析開始: ${dto.results.length}件の結果を分析`,
    );

    const analysis = await this.analysisService.analyzeSearchResults(
      dto.keywords,
      dto.results,
    );

    const analyzedAt = new Date().toISOString();
    if (dto.searchId) {
      await this.attachAnalysisToLog(dto.searchId, analysis, analyzedAt);
    }

    return {
      searchResults: dto.results as DeepSearchResultItem[],
      analysis,
      analyzedAt,
    };
  }

  /** ディープサーチログ一覧（サマリー） */
  async findLogs() {
    return this.logStorage.findAllSummaries();
  }

  /** ディープサーチログ詳細 */
  async findLogById(id: string): Promise<DeepSearchLog | null> {
    return this.logStorage.findById(id);
  }

  /** ログを保存（保存に失敗しても検索自体は成功させる） */
  private async saveLog(log: DeepSearchLog): Promise<void> {
    try {
      await this.logStorage.save(log);
    } catch (error) {
      this.logger.warn(`ディープサーチログの保存に失敗: ${log.id}`, error);
    }
  }

  /** 既存の検索ログに分析結果を記録する */
  private async attachAnalysisToLog(
    searchId: string,
    text: string,
    analyzedAt: string,
  ): Promise<void> {
    try {
      const log = await this.logStorage.findById(searchId);
      if (!log) {
        this.logger.warn(
          `分析対象のディープサーチログが見つかりません: ${searchId}`,
        );
        return;
      }
      await this.logStorage.save({
        ...log,
        analysis: { text, model: CLAUDE_MODEL, analyzedAt },
      });
    } catch (error) {
      this.logger.warn(
        `ディープサーチログへの分析結果の記録に失敗: ${searchId}`,
        error,
      );
    }
  }

  /** PDFからベクトル類似検索 */
  private async searchPdfs(
    keywords: string[],
  ): Promise<DeepSearchResultItem[]> {
    try {
      // キーワードを連結してEmbedding生成
      const queryText = keywords.join(' ');
      const queryVector =
        await this.embeddingService.generateEmbedding(queryText);

      // ベクトル検索
      const vectorResults = await this.vectorSearchService.search(
        queryVector,
        10,
      );

      // 類似度が下限未満のチャンクは無関係とみなして除外する
      const relevantResults = vectorResults.filter(
        (r) => r.score >= this.minPdfSimilarity,
      );
      this.logger.log(
        `PDF検索の類似度フィルタ: ${vectorResults.length}件 → ${relevantResults.length}件（下限=${this.minPdfSimilarity}）`,
      );

      const results: DeepSearchResultItem[] = relevantResults.map((r) => ({
        sourceType: 'pdf' as const,
        sourceName: r.fileName,
        sourceId: r.documentId,
        text: r.text,
        score: r.score,
      }));

      this.logger.log(`PDF検索完了: ${results.length}件`);
      return results;
    } catch (error) {
      this.logger.warn('PDF検索に失敗（スキップ）', error);
      return [];
    }
  }

  /** Web検索 */
  private async searchWeb(
    keywords: string[],
  ): Promise<DeepSearchResultItem[]> {
    try {
      const queryText = keywords.join(' ');
      const { answer, sources } = await this.analysisService.searchAndAnalyze(
        keywords,
        `キーワード「${queryText}」に関連する最新情報を調査してください。`,
      );

      // 回答に引用された記事ごとに、引用本文の抜粋を検索結果にする。
      // Claude の要約やタイトルだけを渡すと、分析が元記事ではなく要約に基づいてしまい、
      // 出典の確認やハルシネーションの検証ができないため
      const results: DeepSearchResultItem[] = sources
        .filter((source) => source.excerpts.length > 0)
        .map((source) => ({
          sourceType: 'web' as const,
          sourceName: source.title,
          sourceId: '',
          text: source.excerpts.join('\n…\n'),
          url: source.url,
        }));

      // 引用が1件もない場合は、Claude の回答を1件の結果として返す。
      // 回答も空の場合（応答が検索結果だけで終わった等）は、見つかった記事のタイトルを返す
      if (results.length === 0 && answer) {
        results.push({
          sourceType: 'web',
          sourceName: 'Web検索結果',
          sourceId: '',
          text: answer,
          url: sources[0]?.url,
        });
      } else if (results.length === 0) {
        for (const source of sources) {
          results.push({
            sourceType: 'web',
            sourceName: source.title,
            sourceId: '',
            text: source.title,
            url: source.url,
          });
        }
      }

      this.logger.log(`Web検索完了: ${results.length}件`);
      return results;
    } catch (error) {
      this.logger.warn('Web検索に失敗（スキップ）', error);
      return [];
    }
  }
}
