import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { DerivedLogCleaner } from '../transcription/derived-log-cleaner.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PrivacyScan } from './privacy.types';

describe('PrivacyScanStore', () => {
  let tmpDir: string;
  let store: PrivacyScanStore;
  let cleaner: DerivedLogCleaner;

  /** 文字起こし transcriptionId のチェック結果（チェック開始時刻は既定で現在） */
  const scan = (
    transcriptionId: string,
    scannedAt = new Date().toISOString(),
  ): PrivacyScan => ({
    transcriptionId,
    scannedAt,
    guardrailId: 'gr-test',
    guardrailVersion: 'DRAFT',
    findings: [
      {
        type: 'NAME',
        label: '氏名',
        text: '山田太郎',
        count: 1,
        mask: false,
        needsReview: true,
      },
    ],
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-scan-'));
    const config = {
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    } as unknown as ConfigService;
    store = new PrivacyScanStore(config);
    cleaner = new DerivedLogCleaner(config);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('保存して読み込める', async () => {
    await expect(store.save(scan('p-ok'))).resolves.toBe(true);
    expect((await store.find('p-ok'))?.findings[0].text).toBe('山田太郎');
  });

  it('チェック中に文字起こしが削除された場合は、検出した文字列を保存しない', async () => {
    const started = scan('p-deleted');
    // チェックの途中で、文字起こしの削除が終わる
    await cleaner.deleteLogsForTranscription('p-deleted');

    await expect(store.save(started)).resolves.toBe(false);
    expect(await store.find('p-deleted')).toBeNull();
    expect(await fs.readdir(path.join(tmpDir, 'privacy-scans'))).toEqual([]);
  });

  it('削除の後に始めたチェックは保存できる（同じ音声を文字起こしし直した場合）', async () => {
    await cleaner.deleteLogsForTranscription('p-redo');
    const later = new Date(Date.now() + 1000).toISOString();
    await expect(store.save(scan('p-redo', later))).resolves.toBe(true);
  });
});
