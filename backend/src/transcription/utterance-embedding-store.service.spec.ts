import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  UtteranceEmbeddingCache,
  UtteranceEmbeddingStore,
} from './utterance-embedding-store.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { PrivacyService } from '../privacy/privacy.service';
import { DerivedLogCleaner } from './derived-log-cleaner.service';
import { GinzaKeywordStore } from './ginza-keyword-store.service';
import { TRANSCRIPTION_STORAGE } from '../storage/interfaces/transcription-storage.interface';

const CACHE: UtteranceEmbeddingCache = {
  modelId: 'test-model',
  dimensions: 2,
  textsHash: 'hash',
  embeddings: [[1, 0]],
};

describe('UtteranceEmbeddingStore', () => {
  let store: UtteranceEmbeddingStore;
  let transcriptionStore: TranscriptionStoreService;
  let storage: { delete: jest.Mock };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'utterance-embedding-'));
    storage = { delete: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UtteranceEmbeddingStore,
        TranscriptionStoreService,
        DerivedLogCleaner,
        GinzaKeywordStore,
        { provide: TRANSCRIPTION_STORAGE, useValue: storage },
        { provide: PrivacyService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
          },
        },
      ],
    }).compile();

    store = module.get(UtteranceEmbeddingStore);
    transcriptionStore = module.get(TranscriptionStoreService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('保存したキャッシュを読み込める', async () => {
    await store.save('t1', CACHE);

    expect(await store.find('t1')).toEqual(CACHE);
  });

  it('保存後に一時ファイルを残さない', async () => {
    await store.save('t1', CACHE);

    const files = await fs.readdir(path.join(tmpDir, 'utterance-embeddings'));
    expect(files).toEqual(['t1.json']);
  });

  it('キャッシュがない・壊れている場合は null を返す', async () => {
    expect(await store.find('missing')).toBeNull();

    await fs.mkdir(path.join(tmpDir, 'utterance-embeddings'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, 'utterance-embeddings', 'broken.json'),
      '{',
    );
    expect(await store.find('broken')).toBeNull();
  });

  it.each([
    ['embeddings がない', { ...CACHE, embeddings: undefined }],
    ['ベクトルの次元が dimensions と異なる', { ...CACHE, embeddings: [[1]] }],
    ['ベクトルに数値以外が入っている', { ...CACHE, embeddings: [[1, 'x']] }],
    ['modelId がない', { ...CACHE, modelId: undefined }],
    ['オブジェクトではない', [CACHE]],
  ])('キャッシュの形式が不正な場合は null を返す（%s）', async (_, value) => {
    await fs.mkdir(path.join(tmpDir, 'utterance-embeddings'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, 'utterance-embeddings', 't1.json'),
      JSON.stringify(value),
    );

    expect(await store.find('t1')).toBeNull();
  });

  it('文字起こしを削除すると発話ベクトルのキャッシュも削除する', async () => {
    await store.save('t1', CACHE);

    await transcriptionStore.delete('t1');

    expect(storage.delete).toHaveBeenCalledWith('t1');
    expect(
      existsSync(path.join(tmpDir, 'utterance-embeddings', 't1.json')),
    ).toBe(false);
  });

  it('キャッシュがない文字起こしも削除できる', async () => {
    await expect(transcriptionStore.delete('t1')).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledWith('t1');
  });
});
