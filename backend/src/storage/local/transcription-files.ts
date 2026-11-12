import * as fs from 'fs/promises';
import * as path from 'path';
import { isSafePathSegment } from '../../common/path-segment';
import { Transcription } from '../../transcription/types/transcription.types';

/** 文字起こしごとのフォルダの中にある、文字起こし結果のファイル名 */
export const TRANSCRIPTION_FILE = 'transcription.json';

/**
 * 文字起こしのフォルダ（transcriptions/）にある文字起こしの ID の一覧
 * - フォルダだけを対象にする（シンボリックリンクは lstat で除く）
 * - transcription.json がないフォルダ（作成途中など）は除く
 * - 保存先のフォルダがなければ空
 */
export async function listTranscriptionIds(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ids: string[] = [];
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(dir, name));
      if (!stat.isDirectory()) continue;
      const file = await fs.lstat(path.join(dir, name, TRANSCRIPTION_FILE));
      if (!file.isFile()) continue;
      ids.push(name);
    } catch {
      // 読み込みの間に削除されたフォルダなどは除く
    }
  }
  return ids;
}

/**
 * 文字起こしの ID として使えるか（1つのフォルダ名であり、保存先の外を指さない）
 * REST の URL パラメータなど、外から来た ID でパスを作る前に確かめる
 */
export function isSafeTranscriptionId(id: string): boolean {
  return isSafePathSegment(id);
}

/**
 * 文字起こし結果を読み込む。ファイルがなければ null
 * ID が1つのフォルダ名でない場合（`..`・`a/b` など）も、保存先の外を読まないよう null
 * JSON として読めない場合（書き込み途中など）は例外を投げる
 */
export async function readTranscriptionFile(
  dir: string,
  id: string,
): Promise<Transcription | null> {
  if (!isSafeTranscriptionId(id)) return null;
  let content: string;
  try {
    content = await fs.readFile(
      path.join(dir, id, TRANSCRIPTION_FILE),
      'utf-8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(content) as Transcription;
}
