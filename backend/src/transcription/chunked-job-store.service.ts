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
          (job.status === 'initializing' ||
            job.status === 'splitting' ||
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

  /** ファイル名で全ジョブ（完了・未完了含む）を検索 */
  async findAllJobsByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob[]> {
    if (!existsSync(this.storeDir)) return [];

    const files = await fs.readdir(this.storeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const matchedJobs: ChunkedTranscriptionJob[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, file),
          'utf-8',
        );
        const job = JSON.parse(content) as ChunkedTranscriptionJob;
        if (job.audioFileName === fileName) {
          matchedJobs.push(job);
        }
      } catch {
        // 読み込み失敗は無視
      }
    }
    return matchedJobs;
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
        job.status !== 'completed' &&
        !completedFileNames.has(job.audioFileName),
    );

    // 同じファイル名のジョブは最新のもの1つだけに絞る
    const latestByFileName = new Map<string, ChunkedTranscriptionJob>();
    for (const job of resumable) {
      const existing = latestByFileName.get(job.audioFileName);
      if (!existing || new Date(job.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        latestByFileName.set(job.audioFileName, job);
      }
    }

    // 更新日時の降順でソート
    return Array.from(latestByFileName.values()).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /** ジョブとチャンク音声ファイルを削除 */
  async delete(jobId: string): Promise<void> {
    // ジョブJSONファイルを削除
    const filePath = path.join(this.storeDir, `${jobId}.json`);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }

    // チャンク音声ディレクトリを削除
    const chunksDir = path.join(this.getChunksBaseDir(), jobId);
    if (existsSync(chunksDir)) {
      await fs.rm(chunksDir, { recursive: true, force: true });
      this.logger.log(`チャンク音声ディレクトリを削除: ${chunksDir}`);
    }
  }
}
