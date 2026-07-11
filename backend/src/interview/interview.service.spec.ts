import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { AnalysisService } from '../claude/analysis.service';
import { SummaryService } from '../claude/summary.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { AnalysisLogStorage, SummaryLogStorage } from './analysis-log.storage';

/** テスト用の文字起こしデータ */
const sampleTranscription = {
  id: 'sample',
  audioFileName: 'sample.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  languageCode: 'ja',
  fullText: 'こんにちは 世界',
  speakers: [
    { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
    { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
  ],
  words: [],
  utterances: [
    {
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: 0,
      end: 1,
      text: 'こんにちは',
      words: [],
    },
    {
      speakerId: 'speaker_1',
      speakerName: 'Bさん',
      start: 1,
      end: 2,
      text: '世界',
      words: [],
    },
  ],
};

describe('InterviewService', () => {
  let module: TestingModule;
  let service: InterviewService;
  let claudeService: jest.Mocked<AnalysisService>;
  let store: jest.Mocked<TranscriptionStoreService>;
  let analysisLogStorage: jest.Mocked<AnalysisLogStorage>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        InterviewService,
        {
          provide: AnalysisService,
          useValue: {
            generateQuestions: jest.fn(),
            buildGenerateQuestionsPrompt: jest.fn(),
            buildAnalysisPrompt: jest.fn(),
            analyze: jest.fn(),
            analyzeContext: jest.fn(),
          },
        },
        {
          provide: SummaryService,
          useValue: {
            summarize: jest.fn(),
          },
        },
        {
          provide: TranscriptionStoreService,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: AnalysisLogStorage,
          useValue: {
            save: jest.fn(),
            findById: jest.fn(),
            findAllSummaries: jest.fn(),
          },
        },
        {
          provide: SummaryLogStorage,
          useValue: {
            save: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InterviewService>(InterviewService);
    claudeService = module.get(AnalysisService);
    store = module.get(TranscriptionStoreService);
    analysisLogStorage = module.get(AnalysisLogStorage);
  });

  describe('generateQuestions', () => {
    it('話者名を取得してClaude APIで調査質問を生成する', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.generateQuestions.mockResolvedValue(['質問1', '質問2']);

      const result = await service.generateQuestions('sample', 'speaker_0', ['キーワード']);

      expect(claudeService.generateQuestions).toHaveBeenCalledWith(['キーワード'], 'Aさん', undefined);
      expect(result).toEqual(['質問1', '質問2']);
    });

    it('文字起こしが存在しない場合はNotFoundExceptionをスロー', async () => {
      store.findById.mockResolvedValue(null);

      await expect(
        service.generateQuestions('missing', 'speaker_0', ['キーワード']),
      ).rejects.toThrow(NotFoundException);
    });

    it('話者IDが見つからない場合は話者IDをそのまま使う', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.generateQuestions.mockResolvedValue([]);

      await service.generateQuestions('sample', 'unknown_speaker', []);

      expect(claudeService.generateQuestions).toHaveBeenCalledWith([], 'unknown_speaker', undefined);
    });
  });

  describe('analyze', () => {
    it('分析を実行してログに保存する', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.analyze.mockResolvedValue([
        { question: 'q1', answer: 'a1', sources: [] },
      ]);
      analysisLogStorage.save.mockResolvedValue(undefined);

      const result = await service.analyze('sample', 'speaker_0', ['kw'], ['q1']);

      expect(result.transcriptionId).toBe('sample');
      expect(result.speakerName).toBe('Aさん');
      expect(result.keywords).toEqual(['kw']);
      expect(result.results).toHaveLength(1);
      expect(analysisLogStorage.save).toHaveBeenCalledWith(result);
    });
  });

  describe('findAnalysisLogs / findAnalysisLogById', () => {
    it('分析ログ一覧を取得する', async () => {
      const summaries = [{ id: 'log-1', transcriptionId: 'sample', speakerId: 'speaker_0', speakerName: 'Aさん', keywords: [], createdAt: '2024-01-01Z' }];
      analysisLogStorage.findAllSummaries.mockResolvedValue(summaries);

      const result = await service.findAnalysisLogs();

      expect(result).toEqual(summaries);
    });

    it('IDで分析ログを取得する', async () => {
      const log = {
        id: 'log-1',
        transcriptionId: 'sample',
        speakerId: 'speaker_0',
        speakerName: 'Aさん',
        keywords: [],
        results: [],
        createdAt: '2024-01-01Z',
      };
      analysisLogStorage.findById.mockResolvedValue(log);

      const result = await service.findAnalysisLogById('log-1');

      expect(result).toEqual(log);
    });

    it('存在しない分析ログIDはNotFoundExceptionをスロー', async () => {
      analysisLogStorage.findById.mockResolvedValue(null);

      await expect(service.findAnalysisLogById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSummaryConfig', () => {
    it('デフォルトプロンプトとモデル一覧を返す', () => {
      const config = service.getSummaryConfig();

      expect(config.defaultPrompt).toBe(SummaryService.DEFAULT_SUMMARY_PROMPT);
      expect(config.models).toEqual(SummaryService.SUMMARY_MODELS);
      expect(config.models.length).toBeGreaterThan(0);
    });
  });

  describe('summarize', () => {
    it('SummaryServiceを呼び出してログを保存し結果を返す', async () => {
      const summaryService = module.get<jest.Mocked<SummaryService>>(SummaryService);
      const summaryLogStorage = module.get<jest.Mocked<SummaryLogStorage>>(SummaryLogStorage);
      store.findById.mockResolvedValue(sampleTranscription);
      summaryService.summarize.mockResolvedValue({
        overview: '会話の概要',
        key_points: [{ topic: 'テーマ1', summary: '要点1' }],
        decisions: ['決定事項1'],
      });
      summaryLogStorage.save.mockResolvedValue(undefined);

      const result = await service.summarize('sample', 'claude-sonnet-4-6', 'プロンプト {{fullText}}');

      expect(summaryService.summarize).toHaveBeenCalledWith(
        sampleTranscription.fullText,
        'claude-sonnet-4-6',
        'プロンプト {{fullText}}',
      );
      expect(summaryLogStorage.save).toHaveBeenCalledWith(result);
      expect(result.transcriptionId).toBe('sample');
      expect(result.overview).toBe('会話の概要');
      expect(result.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('findSummaryLogById', () => {
    it('存在しない要約ログIDはNotFoundExceptionをスロー', async () => {
      const summaryLogStorage = module.get<jest.Mocked<SummaryLogStorage>>(SummaryLogStorage);
      summaryLogStorage.findById.mockResolvedValue(null);

      await expect(service.findSummaryLogById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('analyzeContext', () => {
    it('発話の文脈を分析して結果を返す', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.analyzeContext.mockResolvedValue([
        { index: 1, intent: '説明', topic: '挨拶' },
      ]);

      const result = await service.analyzeContext('sample', [1]);

      expect(result.transcriptionId).toBe('sample');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].utteranceIndex).toBe(1);
      expect(result.results[0].intent).toBe('説明');
      expect(result.results[0].topic).toBe('挨拶');
      // インデックス1の直前発話（インデックス0）が入る
      expect(result.results[0].previousUtterance?.text).toBe('こんにちは');
    });

    it('インデックス0の発話はpreviousUtteranceがnull', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.analyzeContext.mockResolvedValue([
        { index: 0, intent: '質問', topic: '挨拶' },
      ]);

      const result = await service.analyzeContext('sample', [0]);

      expect(result.results[0].previousUtterance).toBeNull();
    });

    it('LLMの結果がない発話はデフォルト値を使う', async () => {
      store.findById.mockResolvedValue(sampleTranscription);
      claudeService.analyzeContext.mockResolvedValue([]);

      const result = await service.analyzeContext('sample', [0]);

      expect(result.results[0].intent).toBe('その他');
      expect(result.results[0].topic).toBe('');
    });

    it('文字起こしが存在しない場合はNotFoundExceptionをスロー', async () => {
      store.findById.mockResolvedValue(null);

      await expect(service.analyzeContext('missing', [0])).rejects.toThrow(NotFoundException);
    });
  });
});
