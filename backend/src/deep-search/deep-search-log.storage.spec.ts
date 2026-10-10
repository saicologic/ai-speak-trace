import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepSearchLogStorage } from './deep-search-log.storage';
import { DeepSearchLog } from './types/deep-search.types';

/** テスト用のディープサーチログ */
function makeLog(id: string, searchedAt: string): DeepSearchLog {
  return {
    id,
    keywords: ['AI'],
    transcriptionIds: ['t1'],
    includePdfs: false,
    includeWeb: true,
    webSearchModel: 'claude-test',
    results: [
      {
        sourceType: 'web',
        sourceName: '記事',
        sourceId: '',
        text: '記事',
        url: 'https://example.com',
      },
    ],
    searchedAt,
  };
}

describe('DeepSearchLogStorage', () => {
  let storage: DeepSearchLogStorage;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deep-search-log-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepSearchLogStorage,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
          },
        },
      ],
    }).compile();

    storage = module.get<DeepSearchLogStorage>(DeepSearchLogStorage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('起動時にはディレクトリを作らず、保存時に作る', async () => {
    expect(existsSync(path.join(tmpDir, 'deep-search-logs'))).toBe(false);

    await storage.save(makeLog('log-1', '2024-01-01T00:00:00Z'));

    expect(await fs.readdir(path.join(tmpDir, 'deep-search-logs'))).toEqual([
      'log-1.json',
    ]);
  });

  it('同じログを同時に保存しても一時ファイルが重ならない', async () => {
    const log = makeLog('log-1', '2024-01-01T00:00:00Z');

    await Promise.all([
      storage.save(log),
      storage.save(log),
      storage.save(log),
    ]);

    expect(await fs.readdir(path.join(tmpDir, 'deep-search-logs'))).toEqual([
      'log-1.json',
    ]);
    expect(await storage.findById('log-1')).toEqual(log);
  });

  it('保存ディレクトリがなくても一覧は空で返す', async () => {
    expect(await storage.findAllSummaries()).toEqual([]);
  });

  describe('save / findById', () => {
    it('ログを保存してIDで取得できる', async () => {
      const log = makeLog('log-1', '2024-01-01T00:00:00Z');

      await storage.save(log);

      expect(await storage.findById('log-1')).toEqual(log);
    });

    it('同じIDで保存すると上書きする', async () => {
      const log = makeLog('log-1', '2024-01-01T00:00:00Z');
      await storage.save(log);

      const analyzed: DeepSearchLog = {
        ...log,
        analysis: {
          text: '分析',
          model: 'claude-test',
          analyzedAt: '2024-01-01T00:01:00Z',
        },
      };
      await storage.save(analyzed);

      expect(await storage.findById('log-1')).toEqual(analyzed);
    });

    it('存在しないIDはnullを返す', async () => {
      expect(await storage.findById('missing')).toBeNull();
    });

    it('IDにパス区切りが含まれても保存ディレクトリ外を読まない', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'secret.json'),
        JSON.stringify({ id: 'secret' }),
      );

      expect(await storage.findById('../secret')).toBeNull();
    });
  });

  describe('findAllSummaries', () => {
    it('searchedAt降順で、結果本文と分析本文を除いたサマリーを返す', async () => {
      await storage.save(makeLog('old', '2024-01-01T00:00:00Z'));
      await storage.save({
        ...makeLog('new', '2024-02-01T00:00:00Z'),
        analysis: {
          text: '分析',
          model: 'claude-test',
          analyzedAt: '2024-02-01T00:01:00Z',
        },
      });

      const summaries = await storage.findAllSummaries();

      expect(summaries.map((s) => s.id)).toEqual(['new', 'old']);
      expect(summaries[0]).toMatchObject({ resultCount: 1, analyzed: true });
      expect(summaries[1]).toMatchObject({ resultCount: 1, analyzed: false });
      expect(summaries[0]).not.toHaveProperty('results');
      expect(summaries[0]).not.toHaveProperty('analysis');
    });

    it('壊れたファイルはスキップする', async () => {
      await storage.save(makeLog('ok', '2024-01-01T00:00:00Z'));
      await fs.writeFile(
        path.join(tmpDir, 'deep-search-logs', 'broken.json'),
        '{',
      );

      const summaries = await storage.findAllSummaries();

      expect(summaries.map((s) => s.id)).toEqual(['ok']);
    });
  });
});
