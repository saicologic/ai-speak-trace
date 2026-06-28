import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PodcastService } from './podcast.service';

describe('PodcastService', () => {
  let service: PodcastService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-test-'));
    // PODCAST_CACHE_DIR 環境変数でキャッシュディレクトリを上書き
    process.env.PODCAST_CACHE_DIR = tmpDir;
    service = new PodcastService();
  });

  afterEach(async () => {
    delete process.env.PODCAST_CACHE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('exists / getCacheDir', () => {
    it('キャッシュディレクトリが存在する場合はtrueを返す', () => {
      expect(service.exists()).toBe(true);
    });

    it('getCacheDirはキャッシュディレクトリのパスを返す', () => {
      expect(service.getCacheDir()).toBe(tmpDir);
    });
  });

  describe('listFiles', () => {
    it('対応する音声ファイルのみを返す', async () => {
      await fs.writeFile(path.join(tmpDir, 'episode.mp3'), 'data');
      await fs.writeFile(path.join(tmpDir, 'podcast.m4a'), 'data');
      await fs.writeFile(path.join(tmpDir, 'image.jpg'), 'data');

      const files = await service.listFiles();

      const fileNames = files.map((f) => f.fileName);
      expect(fileNames).toContain('episode.mp3');
      expect(fileNames).toContain('podcast.m4a');
      expect(fileNames).not.toContain('image.jpg');
    });

    it('最終更新日時の降順でソートされる', async () => {
      // mtimeを制御するため writeFile 後に utimes で日時を変更
      const oldFile = path.join(tmpDir, 'old.mp3');
      const newFile = path.join(tmpDir, 'new.mp3');
      await fs.writeFile(oldFile, 'old');
      await fs.writeFile(newFile, 'new');
      await fs.utimes(oldFile, new Date('2024-01-01'), new Date('2024-01-01'));
      await fs.utimes(newFile, new Date('2024-02-01'), new Date('2024-02-01'));

      const files = await service.listFiles();

      expect(files[0].fileName).toBe('new.mp3');
      expect(files[1].fileName).toBe('old.mp3');
    });

    it('キャッシュディレクトリが存在しない場合は空配列を返す', async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
      process.env.PODCAST_CACHE_DIR = tmpDir;
      const noService = new PodcastService();

      const files = await noService.listFiles();
      expect(files).toEqual([]);
    });

    it('ファイルのサイズと更新日時を含む', async () => {
      const data = Buffer.from('audio data');
      await fs.writeFile(path.join(tmpDir, 'ep.mp3'), data);

      const files = await service.listFiles();

      expect(files[0].sizeBytes).toBe(data.length);
      expect(files[0].lastModified).toBeTruthy();
    });
  });

  describe('readFile', () => {
    it('指定ファイルのBufferを返す', async () => {
      const data = Buffer.from('podcast audio');
      await fs.writeFile(path.join(tmpDir, 'ep.mp3'), data);

      const result = await service.readFile('ep.mp3');

      expect(result).toEqual(data);
    });

    it('存在しないファイルはNotFoundExceptionをスロー', async () => {
      await expect(service.readFile('missing.mp3')).rejects.toThrow(
        'Podcastファイルが見つかりません',
      );
    });
  });
});
