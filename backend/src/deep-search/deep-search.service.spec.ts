import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepSearchService } from './deep-search.service';
import { ConversationSearchService } from './conversation-search.service';
import { EmbeddingService } from '../document/embedding.service';
import { VectorSearchService } from '../document/vector-search.service';
import { AnalysisService } from '../claude/analysis.service';
import { DeepSearchDto, DeepSearchAnalyzeDto } from './dto/deep-search.dto';

describe('DeepSearchService', () => {
  let service: DeepSearchService;
  let conversationSearch: jest.Mocked<ConversationSearchService>;
  let embeddingService: jest.Mocked<EmbeddingService>;
  let vectorSearchService: jest.Mocked<VectorSearchService>;
  let claudeService: jest.Mocked<AnalysisService>;

  /** 指定した環境変数でサービスを生成する */
  const createService = async (
    env: Record<string, string> = {},
  ): Promise<void> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepSearchService,
        {
          provide: ConversationSearchService,
          useValue: {
            search: jest.fn(),
          },
        },
        {
          provide: EmbeddingService,
          useValue: {
            generateEmbedding: jest.fn(),
          },
        },
        {
          provide: VectorSearchService,
          useValue: {
            search: jest.fn(),
          },
        },
        {
          provide: AnalysisService,
          useValue: {
            searchAndAnalyze: jest.fn(),
            analyzeSearchResults: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => env[key]),
          },
        },
      ],
    }).compile();

    service = module.get<DeepSearchService>(DeepSearchService);
    conversationSearch = module.get(ConversationSearchService);
    embeddingService = module.get(EmbeddingService);
    vectorSearchService = module.get(VectorSearchService);
    claudeService = module.get(AnalysisService);
  };

  beforeEach(async () => {
    await createService();
  });

  describe('search', () => {
    it('会話検索の結果を含めて返す', async () => {
      conversationSearch.search.mockResolvedValue([
        {
          sourceType: 'conversation',
          sourceName: 'talk.mp3 - Aさん',
          sourceId: 't1',
          text: 'AIエコシステムについて話しました',
          score: 0.8,
          speakerName: 'Aさん',
        },
      ]);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(conversationSearch.search).toHaveBeenCalledWith(['AI'], ['t1']);
      expect(result.keywords).toEqual(['AI']);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].sourceType).toBe('conversation');
    });

    it('transcriptionIdsが空の場合は会話検索をスキップする', async () => {
      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(conversationSearch.search).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
    });

    it('includePdfs=trueのときPDF検索を実行する', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      vectorSearchService.search.mockResolvedValue([
        {
          text: 'PDF内容',
          score: 0.9,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 0,
        },
      ]);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: true,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].sourceType).toBe('pdf');
    });

    it('類似度が既定の下限（0.3）未満のPDFチャンクは除外する', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      vectorSearchService.search.mockResolvedValue([
        {
          text: '関連あり',
          score: 0.45,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 0,
        },
        {
          text: '境界値',
          score: 0.3,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 1,
        },
        {
          text: '関連なし',
          score: 0.29,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 2,
        },
      ]);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: true,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results.map((r) => r.text)).toEqual(['関連あり', '境界値']);
    });

    it('DEEP_SEARCH_MIN_SIMILARITYで類似度の下限を変更できる', async () => {
      await createService({ DEEP_SEARCH_MIN_SIMILARITY: '0.5' });
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      vectorSearchService.search.mockResolvedValue([
        {
          text: '関連あり',
          score: 0.6,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 0,
        },
        {
          text: '関連なし',
          score: 0.45,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 1,
        },
      ]);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: true,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results.map((r) => r.text)).toEqual(['関連あり']);
    });

    it('DEEP_SEARCH_MIN_SIMILARITYが数値でない場合は既定の下限を使う', async () => {
      await createService({ DEEP_SEARCH_MIN_SIMILARITY: 'abc' });
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      vectorSearchService.search.mockResolvedValue([
        {
          text: '関連なし',
          score: 0.29,
          documentId: 'doc-1',
          fileName: 'doc.pdf',
          chunkIndex: 0,
        },
      ]);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: true,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(0);
    });

    it.each(['1.5', '-2'])(
      'DEEP_SEARCH_MIN_SIMILARITYが範囲外（%s）の場合は既定の下限を使う',
      async (value) => {
        await createService({ DEEP_SEARCH_MIN_SIMILARITY: value });
        embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
        vectorSearchService.search.mockResolvedValue([
          {
            text: '関連あり',
            score: 0.45,
            documentId: 'doc-1',
            fileName: 'doc.pdf',
            chunkIndex: 0,
          },
          {
            text: '関連なし',
            score: 0.29,
            documentId: 'doc-1',
            fileName: 'doc.pdf',
            chunkIndex: 1,
          },
        ]);

        const dto: DeepSearchDto = {
          keywords: ['AI'],
          transcriptionIds: [],
          includePdfs: true,
          includeWeb: false,
        };

        const result = await service.search(dto);

        expect(result.results.map((r) => r.text)).toEqual(['関連あり']);
      },
    );

    it('PDF検索が失敗した場合は空配列でスキップする', async () => {
      embeddingService.generateEmbedding.mockRejectedValue(
        new Error('Bedrock error'),
      );

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: true,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(0);
    });

    it('includeWeb=trueのとき、引用された記事ごとに引用本文を結果にする', async () => {
      claudeService.searchAndAnalyze.mockResolvedValue({
        answer: 'Web検索結果テキスト',
        sources: [
          {
            url: 'https://example.com/a',
            title: '記事A',
            excerpts: ['引用1', '引用2'],
          },
          { url: 'https://example.com/b', title: '記事B', excerpts: [] },
        ],
      });

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      // 引用されなかった記事B と Claude の回答テキストは結果に含めない
      expect(result.results).toEqual([
        {
          sourceType: 'web',
          sourceName: '記事A',
          sourceId: '',
          text: '引用1\n…\n引用2',
          url: 'https://example.com/a',
        },
      ]);
    });

    it('引用も回答もない場合は、見つかった記事のタイトルを結果にする', async () => {
      claudeService.searchAndAnalyze.mockResolvedValue({
        answer: '',
        sources: [
          { url: 'https://example.com/a', title: '記事A', excerpts: [] },
          { url: 'https://example.com/b', title: '記事B', excerpts: [] },
        ],
      });

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      expect(result.results.map((r) => [r.sourceName, r.url])).toEqual([
        ['記事A', 'https://example.com/a'],
        ['記事B', 'https://example.com/b'],
      ]);
    });

    it('引用が1件もない場合はClaudeの回答を結果にする', async () => {
      claudeService.searchAndAnalyze.mockResolvedValue({
        answer: 'Web検索結果テキスト',
        sources: [
          { url: 'https://example.com/a', title: '記事A', excerpts: [] },
        ],
      });

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      expect(result.results).toEqual([
        {
          sourceType: 'web',
          sourceName: 'Web検索結果',
          sourceId: '',
          text: 'Web検索結果テキスト',
          url: 'https://example.com/a',
        },
      ]);
    });

    it('Web検索が失敗した場合は空配列でスキップする', async () => {
      claudeService.searchAndAnalyze.mockRejectedValue(new Error('Claude error'));

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(0);
    });

    it('searchedAtを含んで返す', async () => {
      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.searchedAt).toBeTruthy();
    });
  });

  describe('analyzeResults', () => {
    it('検索結果をClaude APIで分析する', async () => {
      claudeService.analyzeSearchResults.mockResolvedValue('分析レポート');

      const dto: DeepSearchAnalyzeDto = {
        keywords: ['AI'],
        results: [
          {
            sourceType: 'conversation',
            sourceName: 'talk.mp3',
            sourceId: 't1',
            text: 'AIエコシステムについて',
          },
        ],
      };

      const result = await service.analyzeResults(dto);

      expect(result.analysis).toBe('分析レポート');
      expect(result.searchResults).toHaveLength(1);
      expect(result.analyzedAt).toBeTruthy();
    });
  });
});
