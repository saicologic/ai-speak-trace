import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocalAudioStorage } from './local-audio-storage';

describe('LocalAudioStorage', () => {
  let storage: LocalAudioStorage;
  let tmpDir: string;
  let audioDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-storage-test-'));
    audioDir = path.join(tmpDir, 'audio');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalAudioStorage,
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

    storage = module.get<LocalAudioStorage>(LocalAudioStorage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('saveFile / readFile / exists / deleteFile', () => {
    it('ファイルを保存して読み込める', async () => {
      const buffer = Buffer.from('test audio data');

      await storage.saveFile('test.mp3', buffer);
      const result = await storage.readFile('test.mp3');

      expect(result).toEqual(buffer);
    });

    it('存在するファイルはtrueを返す', async () => {
      await storage.saveFile('test.mp3', Buffer.from('data'));
      expect(await storage.exists('test.mp3')).toBe(true);
    });

    it('存在しないファイルはfalseを返す', async () => {
      expect(await storage.exists('missing.mp3')).toBe(false);
    });

    it('ファイルを削除する', async () => {
      await storage.saveFile('test.mp3', Buffer.from('data'));
      await storage.deleteFile('test.mp3');

      expect(await storage.exists('test.mp3')).toBe(false);
    });

    it('存在しないファイルの削除は何もしない', async () => {
      await expect(storage.deleteFile('missing.mp3')).resolves.not.toThrow();
    });
  });

  describe('listFiles', () => {
    it('音声ファイルのみを返す', async () => {
      await storage.saveFile('audio.mp3', Buffer.from('mp3'));
      await storage.saveFile('audio.wav', Buffer.from('wav'));
      await storage.saveFile('document.txt', Buffer.from('txt'));

      const files = await storage.listFiles();

      const fileNames = files.map((f) => f.fileName);
      expect(fileNames).toContain('audio.mp3');
      expect(fileNames).toContain('audio.wav');
      expect(fileNames).not.toContain('document.txt');
    });

    it('ファイルのメタデータ（サイズ・更新日時）を含む', async () => {
      const buffer = Buffer.from('audio data');
      await storage.saveFile('test.mp3', buffer);

      const files = await storage.listFiles();

      expect(files[0].sizeBytes).toBe(buffer.length);
      expect(files[0].lastModified).toBeTruthy();
    });

    it('ディレクトリが存在しない場合は空配列を返す', async () => {
      await fs.rm(audioDir, { recursive: true, force: true });
      const files = await storage.listFiles();
      expect(files).toEqual([]);
    });
  });

  describe('getPlaybackUrl', () => {
    it('ファイル名をエンコードしたパスを返す', async () => {
      const url = await storage.getPlaybackUrl('テスト音声.mp3');
      expect(url).toBe(`/audio/${encodeURIComponent('テスト音声.mp3')}`);
    });
  });

  describe('getUploadUrl', () => {
    it('ローカルストレージはnullを返す', async () => {
      const url = await storage.getUploadUrl('test.mp3');
      expect(url).toBeNull();
    });
  });

  describe('getBaseDir', () => {
    it('ベースディレクトリを返す', () => {
      expect(storage.getBaseDir()).toBe(audioDir);
    });
  });
});
