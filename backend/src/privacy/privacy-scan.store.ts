import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
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
    // パストラバーサル対策: ファイル名部分のみを使う
    return path.join(this.storeDir, `${path.basename(transcriptionId)}.json`);
  }

  /** 保存する（書き込み途中のファイルを残さないよう、一時ファイルから置き換える） */
  async save(scan: PrivacyScan): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.getFilePath(scan.transcriptionId);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(scan, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async find(transcriptionId: string): Promise<PrivacyScan | null> {
    try {
      return JSON.parse(
        await fs.readFile(this.getFilePath(transcriptionId), 'utf-8'),
      ) as PrivacyScan;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
