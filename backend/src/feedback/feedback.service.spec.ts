import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackService } from './feedback.service';
import { FeedbackStore } from './feedback.store';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { DerivedLogCleaner } from '../transcription/derived-log-cleaner.service';

describe('FeedbackService', () => {
  let tmpDir: string;
  let store: FeedbackStore;
  let transcriptionStore: { findById: jest.Mock };
  let service: FeedbackService;
  const config = () =>
    ({
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    }) as unknown as ConfigService;

  const input = {
    feature: 'summary' as const,
    targetId: 'log-1',
    transcriptionId: 't1',
    category: 'unsupported' as const,
    quote: '会話にない内容',
    comment: '元の会話で話していない',
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-'));
    store = new FeedbackStore(config());
    transcriptionStore = {
      findById: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    service = new FeedbackService(
      store,
      transcriptionStore as unknown as TranscriptionStoreService,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('報告を保存し、機能と結果の ID で絞り込んで返す', async () => {
    const saved = await service.create(input);
    await service.create({ ...input, targetId: 'log-2' });

    expect(saved).toMatchObject(input);
    expect(
      await service.find({ feature: 'summary', targetId: 'log-1' }),
    ).toEqual([saved]);
    expect(await service.find({ feature: 'analysis' })).toEqual([]);
  });

  it('文字起こしがない場合は保存しない', async () => {
    transcriptionStore.findById.mockResolvedValue(null);

    await expect(service.create(input)).rejects.toThrow(NotFoundException);
    expect(await service.find({})).toEqual([]);
  });

  it('報告がない場合は空の一覧を返す', async () => {
    expect(await service.find({})).toEqual([]);
  });

  it('文字起こしを削除すると、その報告も削除される', async () => {
    await service.create(input);
    await service.create({ ...input, transcriptionId: 't2' });

    await new DerivedLogCleaner(config()).deleteLogsForTranscription('t1');

    expect((await service.find({})).map((f) => f.transcriptionId)).toEqual([
      't2',
    ]);
  });
});
