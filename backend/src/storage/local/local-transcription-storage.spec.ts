import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocalTranscriptionStorage } from './local-transcription-storage';
import { Transcription } from '../../transcription/types/transcription.types';

/** テスト用の文字起こしデータ */
function makeTranscription(id: string): Transcription {
  return {
    id,
    audioFileName: `${id}.mp3`,
    createdAt: '2024-01-01T00:00:00Z',
    languageCode: 'ja',
    fullText: 'テスト',
    speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }],
    words: [],
    utterances: [],
  };
}

describe('LocalTranscriptionStorage', () => {
  let storage: LocalTranscriptionStorage;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcription-storage-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalTranscriptionStorage,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'DATA_DIR') return tmpDir;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    storage = module.get<LocalTranscriptionStorage>(LocalTranscriptionStorage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('save / findById', () => {
    it('文字起こしを保存してIDで取得できる', async () => {
      const transcription = makeTranscription('test-audio');

      await storage.save(transcription);
      const found = await storage.findById('test-audio');

      expect(found).toEqual(transcription);
    });

    it('存在しないIDはnullを返す', async () => {
      const result = await storage.findById('missing');
      expect(result).toBeNull();
    });

    it('同じIDで保存すると上書きされる', async () => {
      const original = makeTranscription('test-audio');
      await storage.save(original);

      const updated = { ...original, fullText: '更新後のテキスト' };
      await storage.save(updated);

      const found = await storage.findById('test-audio');
      expect(found?.fullText).toBe('更新後のテキスト');
    });
  });

  describe('findAll', () => {
    it('保存済みの全文字起こしを返す', async () => {
      await storage.save(makeTranscription('audio-1'));
      await storage.save(makeTranscription('audio-2'));

      const all = await storage.findAll();

      const ids = all.map((t) => t.id);
      expect(ids).toContain('audio-1');
      expect(ids).toContain('audio-2');
    });

    it('ストアが空の場合は空配列を返す', async () => {
      const all = await storage.findAll();
      expect(all).toEqual([]);
    });

    it('壊れたJSONファイルはスキップされる', async () => {
      const storeDir = path.join(tmpDir, 'transcriptions');
      const brokenDir = path.join(storeDir, 'broken-entry');
      await fs.mkdir(brokenDir, { recursive: true });
      await fs.writeFile(path.join(brokenDir, 'transcription.json'), 'not-json', 'utf-8');
      await storage.save(makeTranscription('valid-audio'));

      const all = await storage.findAll();

      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('valid-audio');
    });
  });

  describe('delete', () => {
    it('IDで文字起こしを削除する', async () => {
      await storage.save(makeTranscription('test-audio'));
      await storage.delete('test-audio');

      const found = await storage.findById('test-audio');
      expect(found).toBeNull();
    });

    it('存在しないIDの削除は何もしない', async () => {
      await expect(storage.delete('missing')).resolves.not.toThrow();
    });
  });
});
