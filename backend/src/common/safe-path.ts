import { BadRequestException } from '@nestjs/common';

/**
 * 1つのファイル名・フォルダ名か（保存先の外を指すおそれがないか）
 * URL や本文から受け取った ID・ファイル名でパスを作る前に確かめる。
 * 空・`.`・`..`・区切り文字（`/`・`\`）・NUL を含む名前は、保存先の外を指すおそれがあるため使えない
 */
export function isSafePathSegment(name: string): boolean {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\0]/.test(name)
  );
}

/** 1つのファイル名・フォルダ名でなければ、400 にする */
export function assertSafePathSegment(name: string, label: string): void {
  if (!isSafePathSegment(name)) {
    throw new BadRequestException(`${label}が正しくありません`);
  }
}
