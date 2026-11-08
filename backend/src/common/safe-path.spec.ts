import { isSafePathSegment } from './safe-path';

describe('isSafePathSegment', () => {
  it.each(['abc', 'B5AAEA5F-1234', '会話_2026-11-05', 'a.b', 'episode 1.mp3'])(
    '1つのファイル名・フォルダ名は使える: %s',
    (name) => {
      expect(isSafePathSegment(name)).toBe(true);
    },
  );

  it.each(['', '.', '..', '../other', 'a/b', '/etc', 'a\\b', 'a\0b'])(
    '保存先の外を指すおそれがある名前は使えない: %j',
    (name) => {
      expect(isSafePathSegment(name)).toBe(false);
    },
  );

  it('文字列でない値は使えない', () => {
    expect(isSafePathSegment(undefined as unknown as string)).toBe(false);
  });
});
