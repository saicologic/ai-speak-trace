import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ChunkedTranscriptionJob } from './types/chunked-job.types';

/** チャンク分割ジョブ状態の永続化サービス */
@Injectable()
export class ChunkedJobStoreService {
  private readonly logger = new Logger(ChunkedJobStoreService.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, 'chunked-jobs'));

    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
    this.logger.log(`チャンクジョブ保存ディレクトリ: ${this.storeDir}`);
  }

  /** チャンクファイル用ディレクトリのベースパスを取得 */
  getChunksBaseDir(): string {
    return path.resolve(path.join(path.dirname(this.storeDir), 'chunks'));
  }

  /** ジョブ状態を保存 */
  async save(job: ChunkedTranscriptionJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    const filePath = path.join(this.storeDir, `${job.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
  }

  /** ジョブIDで取得 */
  async findById(jobId: string): Promise<ChunkedTranscriptionJob | null> {
    const filePath = path.join(this.storeDir, `${jobId}.json`);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ChunkedTranscriptionJob;
  }

  /** ファイル名で進行中または失敗したジョブを検索 */
  async findActiveByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob | null> {
    if (!existsSync(this.storeDir)) return null;

    const files = await fs.readdir(this.storeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, file),
          'utf-8',
        );
        const job = JSON.parse(content) as ChunkedTranscriptionJob;
        if (
          job.audioFileName === fileName &&
          (job.status === 'splitting' ||
            job.status === 'transcribing' ||
            job.status === 'failed')
        ) {
          return job;
        }
      } catch {
        // 読み込み失敗は無視
      }
    }
    return null;
  }

  /** 再開可能な（未完了の）ジョブ一覧を取得 */
  async findResumableJobs(): Promise<ChunkedTranscriptionJob[]> {
    if (!existsSync(this.storeDir)) return [];

    const files = await fs.readdir(this.storeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const allJobs: ChunkedTranscriptionJob[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, file),
          'utf-8',
        );
        allJobs.push(JSON.parse(content) as ChunkedTranscriptionJob);
      } catch {
        // 読み込み失敗は無視
      }
    }

    // 完了済みジョブの audioFileName を収集
    const completedFileNames = new Set(
      allJobs
        .filter((j) => j.status === 'completed')
        .map((j) => j.audioFileName),
    );

    // 未完了ジョブのうち、同じファイル名で完了済みジョブがないものだけ返す
    const resumable = allJobs.filter(
      (job) =>
        (job.status === 'splitting' ||
          job.status === 'transcribing' ||
          job.status === 'failed') &&
        !completedFileNames.has(job.audioFileName),
    );

    // 更新日時の降順でソート
    return resumable.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /** ジョブを削除 */
  async delete(jobId: string): Promise<void> {
    const filePath = path.join(this.storeDir, `${jobId}.json`);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }
}
