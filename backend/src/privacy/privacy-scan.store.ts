import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { wasDeletedSince } from '../transcription/derived-log-cleaner.service';
import { PrivacyScan } from './privacy.types';

/** 個人情報チェックの結果の保存先（DATA_DIR 配下） */
export const PRIVACY_SCANS_DIR = 'privacy-scans';

/** 個人情報チェックの結果をローカルファイルに保存・取得するストア */
@Injectable()
export class PrivacyScanStore {
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, PRIVACY_SCANS_DIR));
  }

  private getFilePath(transcriptionId: string): string {
    return privacyScanPath(this.storeDir, transcriptionId);
  }

  /**
   * 保存する（書き込み途中のファイルを残さないよう、一時ファイルから置き換える）
   * チェックを始めた後（scannedAt 以降）に文字起こしが削除された場合は、検出した文字列を残さないよう保存せず false を返す
   * 置き換えと削除が並行した場合に備えて、置き換えの後にも確認し、削除済みなら消し直す
   */
  async save(scan: PrivacyScan): Promise<boolean> {
    const deleted = () =>
      wasDeletedSince([scan.transcriptionId], scan.scannedAt);
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.getFilePath(scan.transcriptionId);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(scan, null, 2), 'utf-8');
    if (deleted()) {
      await fs.rm(tmpPath, { force: true });
      return false;
    }
    await fs.rename(tmpPath, filePath);
    if (deleted()) {
      await fs.rm(filePath, { force: true });
      return false;
    }
    return true;
  }

  async find(transcriptionId: string): Promise<PrivacyScan | null> {
    return readPrivacyScan(this.storeDir, transcriptionId);
  }
}

/** 個人情報チェックの結果のファイルのパス（パストラバーサル対策: ファイル名部分のみを使う） */
function privacyScanPath(dir: string, transcriptionId: string): string {
  return path.join(dir, `${path.basename(transcriptionId)}.json`);
}

/**
 * 個人情報チェックの結果を読み込む（dir は privacy-scans/ のフォルダ）
 * チェックしていなければ null。JSON として読めない場合は例外を投げる
 */
export async function readPrivacyScan(
  dir: string,
  transcriptionId: string,
): Promise<PrivacyScan | null> {
  try {
    return JSON.parse(
      await fs.readFile(privacyScanPath(dir, transcriptionId), 'utf-8'),
    ) as PrivacyScan;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
