import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isDeletedLogFile } from '../transcription/derived-log-cleaner.service';
import { ResearchJob, ResearchJobSummary } from './types/research.types';

/** 調査ジョブの保存先（DATA_DIR 配下） */
export const RESEARCH_JOBS_DIR = 'research-jobs';

/** 会話の削除で調査ジョブが削除されたため、保存しなかったことを表すエラー */
export class ResearchJobDeletedError extends Error {}

/** 調査ジョブをローカルファイルに保存・取得するストア */
@Injectable()
export class ResearchJobStore {
  private readonly logger = new Logger(ResearchJobStore.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, RESEARCH_JOBS_DIR));
  }

  private getFilePath(id: string): string {
    // パストラバーサル対策: ファイル名部分のみを使う
    return path.join(this.storeDir, `${path.basename(id)}.json`);
  }

  /**
   * 保存する（書き込み途中のファイルを残さないよう、一時ファイルから置き換える）
   * 会話の削除でこのジョブが削除された場合は保存せず、ResearchJobDeletedError を投げる
   * 置き換えと削除が並行した場合に備えて、置き換えの後にも確認し、削除済みなら消し直す
   */
  async save(job: ResearchJob): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.getFilePath(job.id);
    const deleted = () =>
      new ResearchJobDeletedError(`調査ジョブが削除されました: ${job.id}`);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(job, null, 2), 'utf-8');
    if (isDeletedLogFile(filePath)) {
      await fs.rm(tmpPath, { force: true });
      throw deleted();
    }
    await fs.rename(tmpPath, filePath);
    if (isDeletedLogFile(filePath)) {
      await fs.rm(filePath, { force: true });
      throw deleted();
    }
  }

  async findById(id: string): Promise<ResearchJob | null> {
    try {
      return JSON.parse(
        await fs.readFile(this.getFilePath(id), 'utf-8'),
      ) as ResearchJob;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 新しい順のサマリー一覧 */
  async findAllSummaries(): Promise<ResearchJobSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.storeDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const summaries: ResearchJobSummary[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(
          await fs.readFile(path.join(this.storeDir, name), 'utf-8'),
        ) as ResearchJob;
        summaries.push({
          id: job.id,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          status: job.status,
          transcriptionIds: job.transcriptionIds,
          transcriptionNames: job.transcriptionNames,
          keywords: job.confirmed?.keywords ?? [],
        });
      } catch (error) {
        this.logger.warn(`調査ジョブを読めません: ${name}`, error);
      }
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
