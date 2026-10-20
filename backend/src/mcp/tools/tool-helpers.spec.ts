import * as os from 'os';
import * as path from 'path';
import { isSafeId } from '../conversation-reader';
import { DEFAULT_DATA_DIR, resolveDataDir } from '../data-dir';
import { decodeCursor, encodeCursor, formatTime } from './tool-helpers';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [754.6, '12:34'],
    [3723, '1:02:03'],
    [-1, '0:00'],
  ])('%s 秒は %s', (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });
});

describe('cursor', () => {
  it('続きの位置を戻せる', () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(undefined)).toBe(0);
  });

  it.each([
    ['xxx'],
    [Buffer.from('{"offset":-1}').toString('base64url')],
    [Buffer.from('{"offset":1.5}').toString('base64url')],
  ])('不正な cursor は拒否する（%s）', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow('cursor が不正です');
  });
});

describe('isSafeId', () => {
  it('日本語や空白を含む ID は使える', () => {
    expect(isSafeId('雑談 第1回 (2)')).toBe(true);
  });

  it.each([
    [''],
    ['.'],
    ['..'],
    ['a/b'],
    ['a\\b'],
    ['a\0b'],
    ['x'.repeat(256)],
  ])('パスとして危ない ID は使わない（%j）', (id) => {
    expect(isSafeId(id)).toBe(false);
  });
});

describe('resolveDataDir', () => {
  it('既定はデスクトップアプリのデータの保存先', () => {
    expect(resolveDataDir({})).toBe(DEFAULT_DATA_DIR);
    expect(DEFAULT_DATA_DIR).toBe(
      path.join(
        os.homedir(),
        'Library/Application Support/io.github.saicologic.ai-speak-trace/data',
      ),
    );
  });

  it('環境変数 DATA_DIR で上書きできる', () => {
    expect(resolveDataDir({ DATA_DIR: '/tmp/x' })).toBe(path.resolve('/tmp/x'));
  });
});
