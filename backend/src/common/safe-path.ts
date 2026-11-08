import { BadRequestException } from '@nestjs/common';
import { isSafePathSegment } from './path-segment';

export { isSafePathSegment };

/** 1つのファイル名・フォルダ名でなければ、400 にする */
export function assertSafePathSegment(name: string, label: string): void {
  if (!isSafePathSegment(name)) {
    throw new BadRequestException(`${label}が正しくありません`);
  }
}
