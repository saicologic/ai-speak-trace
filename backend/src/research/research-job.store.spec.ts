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

  /** 会話 transcriptionId を使う調査ジョブ（作成時刻は既定で現在） */
  const job = (
    id: string,
    transcriptionId: string,
    createdAt = new Date().toISOString(),
  ): ResearchJob =>
    ({
      id,
      createdAt,
      updatedAt: createdAt,
      status: 'researching',
      transcriptionIds: [transcriptionId],
      transcriptionNames: { [transcriptionId]: `${transcriptionId}.mp3` },
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
    const deleted = job('job-deleted', 't-deleted');
    await store.save(deleted);
    await cleaner.deleteLogsForTranscription('t-deleted');

    await expect(store.save(deleted)).rejects.toBeInstanceOf(
      ResearchJobDeletedError,
    );
    expect(await store.findById('job-deleted')).toBeNull();
    // 一時ファイルも残さない
    expect(await fs.readdir(path.join(tmpDir, 'research-jobs'))).toEqual([]);
  });

  it('会話を読み込んだ後、初めて保存する前に会話が削除された調査ジョブは保存しない', async () => {
    const started = job('job-first', 't-first');
    // 調査ジョブのファイルがまだないうちに、削除の走査が終わる
    await cleaner.deleteLogsForTranscription('t-first');

    await expect(store.save(started)).rejects.toBeInstanceOf(
      ResearchJobDeletedError,
    );
    expect(await store.findById('job-first')).toBeNull();
  });

  it('削除と保存が並行しても、削除した調査ジョブを残さない', async () => {
    const racing = job('job-race', 't-race');
    await store.save(racing);
    // 保存の途中（置き換えの直前）に削除が終わる場合
    const actual =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    jest
      .mocked(fs.rename)
      .mockImplementationOnce(async (from: PathLike, to: PathLike) => {
        await cleaner.deleteLogsForTranscription('t-race');
        await actual.rename(from, to);
      });

    await expect(store.save(racing)).rejects.toBeInstanceOf(
      ResearchJobDeletedError,
    );
    expect(
      existsSync(path.join(tmpDir, 'research-jobs', 'job-race.json')),
    ).toBe(false);
  });

  it('会話の削除より後に始めた調査ジョブは保存できる（同じ音声を文字起こしし直した場合）', async () => {
    await cleaner.deleteLogsForTranscription('t-redo');
    const later = new Date(Date.now() + 1000).toISOString();
    await store.save(job('job-redo', 't-redo', later));
    expect((await store.findById('job-redo'))?.id).toBe('job-redo');
  });
});
