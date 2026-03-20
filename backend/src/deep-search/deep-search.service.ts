import { Injectable, Logger } from '@nestjs/common';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { EmbeddingService } from '../document/embedding.service';
import { VectorSearchService } from '../document/vector-search.service';
import { ClaudeService } from '../claude/claude.service';
import { DeepSearchDto, DeepSearchAnalyzeDto } from './dto/deep-search.dto';
import {
  DeepSearchResponse,
  DeepSearchResultItem,
  DeepSearchAnalysis,
} from './types/deep-search.types';

/** 会話・PDF・Webを横断検索するサービス */
@Injectable()
export class DeepSearchService {
  private readonly logger = new Logger(DeepSearchService.name);

  constructor(
    private readonly transcriptionStore: TranscriptionStoreService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly claudeService: ClaudeService,
  ) {}

  /** ディープサーチ実行（3ソース横断） */
  async search(dto: DeepSearchDto): Promise<DeepSearchResponse> {
    this.logger.log(
      `ディープサーチ開始: keywords=${dto.keywords.join(',')}, transcriptions=${dto.transcriptionIds.length}件`,
    );

    // 各検索を並列実行
    const promises: Promise<DeepSearchResultItem[]>[] = [];

    if (dto.transcriptionIds.length > 0) {
      promises.push(
        this.searchConversations(dto.keywords, dto.transcriptionIds),
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

    return {
      keywords: dto.keywords,
      results,
      searchedAt: new Date().toISOString(),
    };
  }

  /** 検索結果をClaude分析 */
  async analyzeResults(dto: DeepSearchAnalyzeDto): Promise<DeepSearchAnalysis> {
    this.logger.log(
      `ディープサーチ分析開始: ${dto.results.length}件の結果を分析`,
    );

    const analysis = await this.claudeService.analyzeSearchResults(
      dto.keywords,
      dto.results,
    );

    return {
      searchResults: dto.results as DeepSearchResultItem[],
      analysis,
      analyzedAt: new Date().toISOString(),
    };
  }

  /** 会話データからキーワード検索（部分一致） */
  private async searchConversations(
    keywords: string[],
    transcriptionIds: string[],
  ): Promise<DeepSearchResultItem[]> {
    const results: DeepSearchResultItem[] = [];

    for (const id of transcriptionIds) {
      const transcription = await this.transcriptionStore.findById(id);
      if (!transcription) continue;

      for (const utterance of transcription.utterances) {
        const matchedKeywords = keywords.filter((kw) =>
          utterance.text.includes(kw),
        );
        if (matchedKeywords.length > 0) {
          results.push({
            sourceType: 'conversation',
            sourceName: `${transcription.audioFileName} - ${utterance.speakerName}`,
            sourceId: id,
            text: utterance.text,
            speakerName: utterance.speakerName,
          });
        }
      }
    }

    this.logger.log(`会話検索完了: ${results.length}件`);
    return results;
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

      const results: DeepSearchResultItem[] = vectorResults.map((r) => ({
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
      const { answer, sources } = await this.claudeService.searchAndAnalyze(
        keywords,
        `キーワード「${queryText}」に関連する最新情報を調査してください。`,
      );

      const results: DeepSearchResultItem[] = [
        {
          sourceType: 'web',
          sourceName: 'Web検索結果',
          sourceId: '',
          text: answer,
          url: sources[0]?.url,
        },
      ];

      // 個別のソースも結果に追加
      for (const source of sources) {
        results.push({
          sourceType: 'web',
          sourceName: source.title,
          sourceId: '',
          text: source.title,
          url: source.url,
        });
      }

      this.logger.log(`Web検索完了: ${results.length}件`);
      return results;
    } catch (error) {
      this.logger.warn('Web検索に失敗（スキップ）', error);
      return [];
    }
  }
}
