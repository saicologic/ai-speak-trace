import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { ChunkedJobStoreService } from './chunked-job-store.service';

describe('ChunkedJobStoreService の保存先の外を指すジョブ ID', () => {
  let tmpDir: string;
  let store: ChunkedJobStoreService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunked-job-test-'));
    store = new ChunkedJobStoreService({
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('delete は保存先の外のフォルダを消さずに例外にする', async () => {
    // 保存先（chunked-jobs/）の外に置いた、消されてはいけないフォルダ
    const outside = path.join(tmpDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');

    await expect(store.delete('..')).rejects.toThrow();
    await expect(store.delete('../outside')).rejects.toThrow();

    await expect(
      fs.readFile(path.join(outside, 'keep.txt'), 'utf-8'),
    ).resolves.toBe('keep');
    await expect(fs.stat(tmpDir)).resolves.toBeTruthy();
  });

  it('findById は保存先の外の job.json を読まずに null を返す', async () => {
    const outside = path.join(tmpDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'job.json'), '{"id":"outside"}');
    await expect(store.findById('../outside')).resolves.toBeNull();
  });
});
