import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, PathLike } from 'fs';
import { ConfigService } from '@nestjs/config';
import { DerivedLogCleaner } from '../transcription/derived-log-cleaner.service';
import {
  ResearchJobDeletedError,
  ResearchJobStore,
} from './research-job.store';
import { ResearchJob } from './types/research.types';

// 置き換えの途中に削除を割り込ませるため、rename だけ差し替えられるようにする
jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, rename: jest.fn(actual.rename) };
});

describe('ResearchJobStore', () => {
  let tmpDir: string;
  let store: ResearchJobStore;
  let cleaner: DerivedLogCleaner;

  const job = (id: string): ResearchJob =>
    ({
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'researching',
      transcriptionIds: ['t1'],
      transcriptionNames: { t1: 't1.mp3' },
    }) as unknown as ResearchJob;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-job-'));
    const config = {
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    } as unknown as ConfigService;
    store = new ResearchJobStore(config);
    cleaner = new DerivedLogCleaner(config);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('会話の削除で消えた調査ジョブは、保存し直さない', async () => {
    await store.save(job('job-deleted'));
    await cleaner.deleteLogsForTranscription('t1');

    await expect(store.save(job('job-deleted'))).rejects.toBeInstanceOf(
      ResearchJobDeletedError,
    );
    expect(await store.findById('job-deleted')).toBeNull();
    // 一時ファイルも残さない
    expect(await fs.readdir(path.join(tmpDir, 'research-jobs'))).toEqual([]);
  });

  it('削除と保存が並行しても、削除した調査ジョブを残さない', async () => {
    await store.save(job('job-race'));
    // 保存の途中（置き換えの直前）に削除が終わる場合
    const actual =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    jest
      .mocked(fs.rename)
      .mockImplementationOnce(async (from: PathLike, to: PathLike) => {
        await cleaner.deleteLogsForTranscription('t1');
        await actual.rename(from, to);
      });

    await expect(store.save(job('job-race'))).rejects.toBeInstanceOf(
      ResearchJobDeletedError,
    );
    expect(
      existsSync(path.join(tmpDir, 'research-jobs', 'job-race.json')),
    ).toBe(false);
  });

  it('削除されていない調査ジョブは保存できる', async () => {
    await store.save(job('job-ok'));
    expect((await store.findById('job-ok'))?.id).toBe('job-ok');
  });
});
