import * as os from 'os';
import * as path from 'path';
import { ConversationReader } from '../conversation-reader';
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

describe('ConversationReader.handleOf', () => {
  it('同じ鍵なら同じ ID になり、フォルダ名を含まない', () => {
    const key = Buffer.alloc(32, 1);
    const id = new ConversationReader('', key).handleOf('架空の面談 第1回');
    expect(id).toMatch(/^t_[0-9a-f]{24}$/);
    expect(new ConversationReader('', key).handleOf('架空の面談 第1回')).toBe(
      id,
    );
  });

  it('鍵が違えば別の ID になる（既定の鍵はプロセスごとに作る）', () => {
    expect(new ConversationReader('').handleOf('a')).not.toBe(
      new ConversationReader('').handleOf('a'),
    );
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
