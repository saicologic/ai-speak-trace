import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_TOP_K,
  ConversationSearchService,
} from './conversation-search.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { EmbeddingService } from '../document/embedding.service';
import { Transcription } from '../transcription/types/transcription.types';

/** 発話テキストから文字起こしデータを作る */
function makeTranscription(texts: string[]): Transcription {
  return {
    id: 't1',
    audioFileName: 'talk.mp3',
    createdAt: '2024-01-01T00:00:00Z',
    languageCode: 'ja',
    fullText: texts.join(''),
    speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }],
    words: [],
    utterances: texts.map((text, i) => ({
      speakerId: 'speaker_0',
      speakerName: 'Aさん',
      start: i,
      end: i + 1,
      text,
      words: [],
    })),
  };
}

/**
 * テスト用の埋め込み: テキストごとに決めた2次元の単位ベクトルを返す
 * 検索語 'AI' は [1, 0] とし、発話との内積がそのまま類似度になる
 */
const VECTORS: Record<string, number[]> = {
  AI: [1, 0],
  AIの話です: [0.6, 0.8],
  人工知能の評価について: [0.9, 0.436],
  関係のない雑談: [0, 1],
};

describe('ConversationSearchService', () => {
  let service: ConversationSearchService;
  let transcriptionStore: { findById: jest.Mock };
  let embeddingService: {
    generateEmbedding: jest.Mock;
    generateEmbeddings: jest.Mock;
    getModelId: jest.Mock;
    getDimensions: jest.Mock;
  };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-search-'));
    transcriptionStore = { findById: jest.fn() };
    embeddingService = {
      generateEmbedding: jest.fn((text: string) =>
        Promise.resolve(VECTORS[text]),
      ),
      generateEmbeddings: jest.fn((texts: string[]) =>
        Promise.resolve(texts.map((t) => VECTORS[t] ?? [0, 0])),
      ),
      getModelId: jest.fn(() => 'test-model'),
      getDimensions: jest.fn(() => 2),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationSearchService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
          },
        },
        { provide: TranscriptionStoreService, useValue: transcriptionStore },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get(ConversationSearchService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('キーワードを含まない言い換えの発話も、意味が近ければ上位に返す', async () => {
    transcriptionStore.findById.mockResolvedValue(
      makeTranscription([
        '関係のない雑談',
        '人工知能の評価について',
        'AIの話です',
      ]),
    );

    const results = await service.search(['AI'], ['t1']);

    // 「人工知能の評価について」は類似度 0.9、「AIの話です」は 0.6 + キーワード加点 0.1
    expect(results.map((r) => r.text)).toEqual([
      '人工知能の評価について',
      'AIの話です',
      '関係のない雑談',
    ]);
    expect(results[0]).toMatchObject({
      sourceType: 'conversation',
      sourceId: 't1',
      speakerName: 'Aさん',
      score: 0.9,
    });
  });

  it(`1つの会話から返すのは上位${CONVERSATION_TOP_K}件まで`, async () => {
    transcriptionStore.findById.mockResolvedValue(
      makeTranscription(Array.from({ length: 8 }, () => 'AIの話です')),
    );

    const results = await service.search(['AI'], ['t1']);

    expect(results).toHaveLength(CONVERSATION_TOP_K);
  });

  it('発話ベクトルをキャッシュし、2回目は生成しない', async () => {
    transcriptionStore.findById.mockResolvedValue(
      makeTranscription(['AIの話です', '関係のない雑談']),
    );

    await service.search(['AI'], ['t1']);
    await service.search(['AI'], ['t1']);

    expect(embeddingService.generateEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('発話が編集されたらベクトルを作り直す', async () => {
    transcriptionStore.findById.mockResolvedValueOnce(
      makeTranscription(['AIの話です']),
    );
    await service.search(['AI'], ['t1']);

    transcriptionStore.findById.mockResolvedValueOnce(
      makeTranscription(['AIの話です', '関係のない雑談']),
    );
    await service.search(['AI'], ['t1']);

    expect(embeddingService.generateEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('空の発話はベクトル化せず、類似度0として扱う', async () => {
    transcriptionStore.findById.mockResolvedValue(
      makeTranscription(['', 'AIの話です']),
    );

    const results = await service.search(['AI'], ['t1']);

    expect(embeddingService.generateEmbeddings).toHaveBeenCalledWith([
      'AIの話です',
    ]);
    expect(results.map((r) => r.score)).toEqual([0.6, 0]);
  });

  it('ベクトル化に失敗したらキーワード一致で検索する', async () => {
    embeddingService.generateEmbedding.mockRejectedValue(
      new Error('AWS未設定'),
    );
    transcriptionStore.findById.mockResolvedValue(
      makeTranscription(['AIの話です', '関係のない雑談', 'AIの評価']),
    );

    const results = await service.search(['AI'], ['t1']);

    expect(results.map((r) => r.text)).toEqual(['AIの話です', 'AIの評価']);
    expect(results[0].score).toBeUndefined();
  });

  it('存在しない文字起こしIDはスキップする', async () => {
    transcriptionStore.findById.mockResolvedValue(null);

    const results = await service.search(['AI'], ['missing']);

    expect(results).toEqual([]);
    expect(embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });
});
