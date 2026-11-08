import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnalysisLogStorage, SummaryLogStorage } from './analysis-log.storage';
import { InterviewAnalysis } from './types/interview.types';

/** テスト用の分析ログデータ */
function makeLog(id: string, createdAt: string): InterviewAnalysis {
  return {
    id,
    transcriptionId: 'sample',
    speakerId: 'speaker_0',
    speakerName: 'Aさん',
    keywords: ['キーワード'],
    results: [{ question: 'q1', answer: 'a1', sources: [] }],
    createdAt,
  };
}

describe('AnalysisLogStorage', () => {
  let storage: AnalysisLogStorage;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-log-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisLogStorage,
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

    storage = module.get<AnalysisLogStorage>(AnalysisLogStorage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('save / findById', () => {
    it('分析ログを保存してIDで取得できる', async () => {
      const log = makeLog('log-1', '2024-01-01T00:00:00Z');

      await storage.save(log);
      const found = await storage.findById('log-1');

      expect(found).toEqual(log);
    });

    it('存在しないIDはnullを返す', async () => {
      const result = await storage.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('保存先の外を指す ID', () => {
    it('findById は保存先の外の .json を読まずに null を返す', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'outside.json'),
        JSON.stringify(makeLog('outside', '2026-01-01T00:00:00Z')),
      );
      await expect(storage.findById('../outside')).resolves.toBeNull();
    });

    it('save は保存先の外に書き込まずに例外にする', async () => {
      await expect(
        storage.save(makeLog('../written', '2026-01-01T00:00:00Z')),
      ).rejects.toThrow();
      expect(existsSync(path.join(tmpDir, 'written.json'))).toBe(false);
    });
  });

  describe('findAllSummaries', () => {
    it('createdAt降順でサマリーを返す', async () => {
      await storage.save(makeLog('log-old', '2024-01-01T00:00:00Z'));
      await storage.save(makeLog('log-new', '2024-02-01T00:00:00Z'));

      const summaries = await storage.findAllSummaries();

      expect(summaries[0].id).toBe('log-new');
      expect(summaries[1].id).toBe('log-old');
    });

    it('サマリーにresultsは含まれない', async () => {
      await storage.save(makeLog('log-1', '2024-01-01T00:00:00Z'));

      const summaries = await storage.findAllSummaries();

      expect((summaries[0] as Record<string, unknown>).results).toBeUndefined();
    });

    it('ログが存在しない場合は空配列を返す', async () => {
      const summaries = await storage.findAllSummaries();
      expect(summaries).toEqual([]);
    });

    it('壊れたJSONファイルは読み込みをスキップする', async () => {
      const storeDir = path.join(tmpDir, 'analysis-logs');
      await fs.writeFile(
        path.join(storeDir, 'broken.json'),
        'not-json',
        'utf-8',
      );
      await storage.save(makeLog('log-valid', '2024-01-01T00:00:00Z'));

      const summaries = await storage.findAllSummaries();

      // 壊れたファイルはスキップされ、有効なファイルのみ返る
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe('log-valid');
    });
  });
});

describe('SummaryLogStorage', () => {
  let tmpDir: string;
  let storage: SummaryLogStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-log-test-'));
    storage = new SummaryLogStorage({
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('findById は保存先の外の .json を読まずに null を返す', async () => {
    await fs.writeFile(path.join(tmpDir, 'outside.json'), '{"id":"outside"}');
    await expect(storage.findById('../outside')).resolves.toBeNull();
  });
});
