import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { wasDeletedSince } from '../transcription/derived-log-cleaner.service';
import { Feedback } from './types/feedback.types';

/** 誤りの報告の保存先（DATA_DIR 配下） */
export const FEEDBACK_DIR = 'feedback';

/** 誤りの報告をローカルファイルに保存・取得するストア（1件1ファイル） */
@Injectable()
export class FeedbackStore {
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, FEEDBACK_DIR));
  }

  /**
   * 保存する（書き込み途中のファイルを残さないよう、一時ファイルから置き換える）
   * 報告を作った後に文字起こしが削除された場合は、会話の抜粋を残さないよう保存せず false を返す
   */
  async save(feedback: Feedback): Promise<boolean> {
    const deleted = () =>
      wasDeletedSince([feedback.transcriptionId], feedback.createdAt);
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = path.join(
      this.storeDir,
      `${path.basename(feedback.id)}.json`,
    );
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(feedback, null, 2), 'utf-8');
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

  /** すべての報告を新しい順に返す（読めないファイルは飛ばす） */
  async findAll(): Promise<Feedback[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.storeDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const items: Feedback[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        items.push(
          JSON.parse(
            await fs.readFile(path.join(this.storeDir, name), 'utf-8'),
          ) as Feedback,
        );
      } catch {
        // 壊れたファイルは一覧に出さない
      }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
