import { Test, TestingModule } from '@nestjs/testing';
import { DeepSearchService } from './deep-search.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { EmbeddingService } from '../document/embedding.service';
import { VectorSearchService } from '../document/vector-search.service';
import { AnalysisService } from '../claude/analysis.service';
import { DeepSearchDto, DeepSearchAnalyzeDto } from './dto/deep-search.dto';

/** テスト用の文字起こしデータ */
const sampleTranscription = {
  id: 't1',
  audioFileName: 'talk.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  languageCode: 'ja',
  fullText: 'AIエコシステムについて話しました',
  speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }],
  words: [],
  utterances: [
    {
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: 0,
      end: 3,
      text: 'AIエコシステムについて話しました',
      words: [],
    },
    {
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: 3,
      end: 5,
      text: '関係のない話',
      words: [],
    },
  ],
};

describe('DeepSearchService', () => {
  let service: DeepSearchService;
  let transcriptionStore: jest.Mocked<TranscriptionStoreService>;
  let embeddingService: jest.Mocked<EmbeddingService>;
  let vectorSearchService: jest.Mocked<VectorSearchService>;
  let claudeService: jest.Mocked<AnalysisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepSearchService,
        {
          provide: TranscriptionStoreService,
          useValue: {
            findById: jest.fn(),
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
      ],
    }).compile();

    service = module.get<DeepSearchService>(DeepSearchService);
    transcriptionStore = module.get(TranscriptionStoreService);
    embeddingService = module.get(EmbeddingService);
    vectorSearchService = module.get(VectorSearchService);
    claudeService = module.get(AnalysisService);
  });

  describe('search', () => {
    it('キーワードにマッチする会話発話を返す', async () => {
      transcriptionStore.findById.mockResolvedValue(sampleTranscription);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.keywords).toEqual(['AI']);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].sourceType).toBe('conversation');
      expect(result.results[0].text).toContain('AI');
    });

    it('マッチしない発話は含まれない', async () => {
      transcriptionStore.findById.mockResolvedValue(sampleTranscription);

      const dto: DeepSearchDto = {
        keywords: ['存在しないキーワード'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(0);
    });

    it('transcriptionIdsが空の場合は会話検索をスキップする', async () => {
      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(transcriptionStore.findById).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
    });

    it('存在しない文字起こしIDは結果に含めずスキップする', async () => {
      transcriptionStore.findById.mockResolvedValue(null);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: ['missing'],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(0);
    });

    it('includePdfs=trueのときPDF検索を実行する', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2]);
      vectorSearchService.search.mockResolvedValue([
        { text: 'PDF内容', score: 0.9, documentId: 'doc-1', fileName: 'doc.pdf', chunkIndex: 0 },
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

    it('PDF検索が失敗した場合は空配列でスキップする', async () => {
      embeddingService.generateEmbedding.mockRejectedValue(new Error('Bedrock error'));

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
