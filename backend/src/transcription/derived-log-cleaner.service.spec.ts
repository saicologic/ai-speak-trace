import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DerivedLogCleaner } from './derived-log-cleaner.service';

describe('DerivedLogCleaner', () => {
  let cleaner: DerivedLogCleaner;
  let tmpDir: string;

  /** テスト用のログファイルを書く */
  const writeLog = async (dir: string, name: string, log: object) => {
    await fs.mkdir(path.join(tmpDir, dir), { recursive: true });
    await fs.writeFile(path.join(tmpDir, dir, name), JSON.stringify(log));
  };
  const exists = (dir: string, name: string) =>
    existsSync(path.join(tmpDir, dir, name));

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-log-'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DerivedLogCleaner,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
          },
        },
      ],
    }).compile();
    cleaner = module.get(DerivedLogCleaner);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('削除した文字起こしを使った会話分析・要約・ディープサーチのログを削除する', async () => {
    await writeLog('analysis-logs', 'a1.json', { transcriptionId: 't1' });
    await writeLog('analysis-logs', 'a2.json', { transcriptionId: 't2' });
    await writeLog('summary-logs', 's1.json', { transcriptionId: 't1' });
    await writeLog('deep-search-logs', 'd1.json', {
      transcriptionIds: ['t2', 't1'],
    });
    await writeLog('deep-search-logs', 'd2.json', { transcriptionIds: ['t2'] });

    const deleted = await cleaner.deleteLogsForTranscription('t1');

    expect(deleted).toBe(3);
    expect(exists('analysis-logs', 'a1.json')).toBe(false);
    expect(exists('summary-logs', 's1.json')).toBe(false);
    expect(exists('deep-search-logs', 'd1.json')).toBe(false);
    // 別の文字起こしのログは残す
    expect(exists('analysis-logs', 'a2.json')).toBe(true);
    expect(exists('deep-search-logs', 'd2.json')).toBe(true);
  });

  it('ログのディレクトリがなくても失敗しない', async () => {
    await expect(cleaner.deleteLogsForTranscription('t1')).resolves.toBe(0);
  });

  it('壊れたログは消さずにスキップする', async () => {
    await fs.mkdir(path.join(tmpDir, 'summary-logs'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'summary-logs', 'broken.json'), '{');

    await expect(cleaner.deleteLogsForTranscription('t1')).resolves.toBe(0);
    expect(exists('summary-logs', 'broken.json')).toBe(true);
  });
});
