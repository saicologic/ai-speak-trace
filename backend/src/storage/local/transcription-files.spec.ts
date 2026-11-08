import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  TRANSCRIPTION_FILE,
  isSafeTranscriptionId,
  readTranscriptionFile,
} from './transcription-files';

describe('isSafeTranscriptionId', () => {
  it.each(['abc', 'B5AAEA5F-1234', '会話_2026-11-05', 'a.b'])(
    '1つのフォルダ名は使える: %s',
    (id) => {
      expect(isSafeTranscriptionId(id)).toBe(true);
    },
  );

  it.each([
    '',
    '.',
    '..',
    '../other',
    'a/b',
    '/etc',
    'a\0b',
    'a\\b',
    '..\\other',
  ])('保存先の外を指すおそれがある ID は使えない: %j', (id) => {
    expect(isSafeTranscriptionId(id)).toBe(false);
  });
});

describe('readTranscriptionFile', () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    // root/transcriptions/ を保存先とし、その外（root/）にも transcription.json を置く
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'transcription-files-test-'),
    );
    dir = path.join(root, 'transcriptions');
    await fs.mkdir(path.join(dir, 'inside'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'inside', TRANSCRIPTION_FILE),
      JSON.stringify({ id: 'inside' }),
      'utf-8',
    );
    await fs.mkdir(path.join(root, 'outside'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'outside', TRANSCRIPTION_FILE),
      JSON.stringify({ id: 'outside' }),
      'utf-8',
    );
    await fs.writeFile(
      path.join(root, TRANSCRIPTION_FILE),
      JSON.stringify({ id: 'root' }),
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('保存先の中の文字起こしを読める', async () => {
    await expect(readTranscriptionFile(dir, 'inside')).resolves.toEqual({
      id: 'inside',
    });
  });

  it('ファイルがなければ null', async () => {
    await expect(readTranscriptionFile(dir, 'missing')).resolves.toBeNull();
  });

  it.each(['..', '../outside', 'inside/../../outside'])(
    '保存先の外を指す ID では読まずに null: %s',
    async (id) => {
      await expect(readTranscriptionFile(dir, id)).resolves.toBeNull();
    },
  );
});
