import { Test, TestingModule } from '@nestjs/testing';
import { DeepSearchService } from './deep-search.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { EmbeddingService } from '../document/embedding.service';
import { VectorSearchService } from '../document/vector-search.service';
import { AnalysisService, CLAUDE_MODEL } from '../claude/analysis.service';
import { DeepSearchLogStorage } from './deep-search-log.storage';
import { DeepSearchLog } from './types/deep-search.types';
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
  let logStorage: jest.Mocked<DeepSearchLogStorage>;

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
        {
          provide: DeepSearchLogStorage,
          useValue: {
            save: jest.fn(),
            findById: jest.fn(),
            findAllSummaries: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DeepSearchService>(DeepSearchService);
    transcriptionStore = module.get(TranscriptionStoreService);
    embeddingService = module.get(EmbeddingService);
    vectorSearchService = module.get(VectorSearchService);
    claudeService = module.get(AnalysisService);
    logStorage = module.get(DeepSearchLogStorage);
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

    it('includeWeb=trueのときWeb検索を実行する', async () => {
      claudeService.searchAndAnalyze.mockResolvedValue({
        answer: 'Web検索結果テキスト',
        sources: [{ url: 'https://example.com', title: '例サイト' }],
      });

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      const webResults = result.results.filter((r) => r.sourceType === 'web');
      expect(webResults.length).toBeGreaterThan(0);
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

    it('検索条件と結果をログに保存し、ログIDを返す', async () => {
      transcriptionStore.findById.mockResolvedValue(sampleTranscription);
      claudeService.searchAndAnalyze.mockResolvedValue({
        answer: 'Web調査結果',
        sources: [{ title: '記事', url: 'https://example.com' }],
      });

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: true,
      };

      const result = await service.search(dto);

      expect(logStorage.save).toHaveBeenCalledTimes(1);
      const saved = logStorage.save.mock.calls[0][0];
      expect(saved).toEqual({
        id: result.id,
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: true,
        webSearchModel: CLAUDE_MODEL,
        results: result.results,
        searchedAt: result.searchedAt,
      });
      expect(saved.results.map((r) => r.sourceType)).toEqual([
        'conversation',
        'web',
        'web',
      ]);
    });

    it('Web検索をしない場合はwebSearchModelを記録しない', async () => {
      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: [],
        includePdfs: false,
        includeWeb: false,
      };

      await service.search(dto);

      expect(logStorage.save.mock.calls[0][0]).not.toHaveProperty(
        'webSearchModel',
      );
    });

    it('ログの保存に失敗しても検索結果を返す', async () => {
      logStorage.save.mockRejectedValue(new Error('disk full'));
      transcriptionStore.findById.mockResolvedValue(sampleTranscription);

      const dto: DeepSearchDto = {
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: false,
      };

      const result = await service.search(dto);

      expect(result.results).toHaveLength(1);
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

    it('searchIdを指定すると検索ログに分析結果を記録する', async () => {
      const log: DeepSearchLog = {
        id: 'search-1',
        keywords: ['AI'],
        transcriptionIds: ['t1'],
        includePdfs: false,
        includeWeb: false,
        results: [],
        searchedAt: '2024-01-01T00:00:00Z',
      };
      logStorage.findById.mockResolvedValue(log);
      claudeService.analyzeSearchResults.mockResolvedValue('分析レポート');

      const result = await service.analyzeResults({
        keywords: ['AI'],
        searchId: 'search-1',
        results: [],
      });

      expect(logStorage.findById).toHaveBeenCalledWith('search-1');
      expect(logStorage.save).toHaveBeenCalledWith({
        ...log,
        analysis: {
          text: '分析レポート',
          model: CLAUDE_MODEL,
          analyzedAt: result.analyzedAt,
        },
      });
    });

    it('searchIdがない場合はログを更新しない', async () => {
      claudeService.analyzeSearchResults.mockResolvedValue('分析レポート');

      await service.analyzeResults({ keywords: ['AI'], results: [] });

      expect(logStorage.findById).not.toHaveBeenCalled();
      expect(logStorage.save).not.toHaveBeenCalled();
    });

    it('検索ログが見つからなくても分析結果を返す', async () => {
      logStorage.findById.mockResolvedValue(null);
      claudeService.analyzeSearchResults.mockResolvedValue('分析レポート');

      const result = await service.analyzeResults({
        keywords: ['AI'],
        searchId: 'missing',
        results: [],
      });

      expect(result.analysis).toBe('分析レポート');
      expect(logStorage.save).not.toHaveBeenCalled();
    });
  });
});
