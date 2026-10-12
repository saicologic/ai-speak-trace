import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  GinzaKeywordCache,
  GinzaKeywordStore,
} from './ginza-keyword-store.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { UtteranceEmbeddingStore } from './utterance-embedding-store.service';
import { PrivacyService } from '../privacy/privacy.service';
import { DerivedLogCleaner } from './derived-log-cleaner.service';
import { TRANSCRIPTION_STORAGE } from '../storage/interfaces/transcription-storage.interface';

const CACHE: GinzaKeywordCache = {
  engineHash: 'engine',
  textsHash: 'texts',
  terms: [[['評価', '評価']], []],
};

describe('GinzaKeywordStore', () => {
  let store: GinzaKeywordStore;
  let transcriptionStore: TranscriptionStoreService;
  let storage: { delete: jest.Mock };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ginza-keywords-'));
    storage = { delete: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GinzaKeywordStore,
        UtteranceEmbeddingStore,
        TranscriptionStoreService,
        DerivedLogCleaner,
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

    store = module.get(GinzaKeywordStore);
    transcriptionStore = module.get(TranscriptionStoreService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('保存したキャッシュを読み込め、一時ファイルを残さない', async () => {
    await store.save('t1', CACHE);

    expect(await store.find('t1')).toEqual(CACHE);
    expect(await fs.readdir(path.join(tmpDir, 'ginza-keywords'))).toEqual([
      't1.json',
    ]);
  });

  it('キャッシュがない・壊れている場合は null を返す', async () => {
    expect(await store.find('missing')).toBeNull();

    await fs.mkdir(path.join(tmpDir, 'ginza-keywords'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'ginza-keywords', 'broken.json'), '{');
    expect(await store.find('broken')).toBeNull();
  });

  it.each([
    ['terms がない', { ...CACHE, terms: undefined }],
    ['語が [正規化した語, 表記] ではない', { ...CACHE, terms: [[['評価']]] }],
    ['語に文字列以外が入っている', { ...CACHE, terms: [[['評価', 1]]] }],
    ['engineHash がない', { ...CACHE, engineHash: undefined }],
  ])('キャッシュの形式が不正な場合は null を返す（%s）', async (_, value) => {
    await fs.mkdir(path.join(tmpDir, 'ginza-keywords'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'ginza-keywords', 't1.json'),
      JSON.stringify(value),
    );

    expect(await store.find('t1')).toBeNull();
  });

  it('ID のフォルダ部分を使わない（パストラバーサル対策）', async () => {
    await store.save('../t1', CACHE);

    expect(existsSync(path.join(tmpDir, 'ginza-keywords', 't1.json'))).toBe(
      true,
    );
  });

  it('文字起こしを削除すると GiNZA のキャッシュも削除する', async () => {
    await store.save('t1', CACHE);

    await transcriptionStore.delete('t1');

    expect(storage.delete).toHaveBeenCalledWith('t1');
    expect(existsSync(path.join(tmpDir, 'ginza-keywords', 't1.json'))).toBe(
      false,
    );
  });
});
