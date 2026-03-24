import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ChunkedTranscriptionJob } from './types/chunked-job.types';

/** チャンク分割ジョブ状態の永続化サービス（フォルダベース） */
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

  /** ジョブIDからジョブフォルダパスを取得 */
  private getJobDir(jobId: string): string {
    return path.join(this.storeDir, jobId);
  }

  /** ジョブIDからjob.jsonパスを取得 */
  private getJobFilePath(jobId: string): string {
    return path.join(this.getJobDir(jobId), 'job.json');
  }

  /** ジョブ状態を保存 */
  async save(job: ChunkedTranscriptionJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    const jobDir = this.getJobDir(job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(
      path.join(jobDir, 'job.json'),
      JSON.stringify(job, null, 2),
      'utf-8',
    );
  }

  /** ジョブIDで取得 */
  async findById(jobId: string): Promise<ChunkedTranscriptionJob | null> {
    const filePath = this.getJobFilePath(jobId);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ChunkedTranscriptionJob;
  }

  /** ファイル名で進行中または失敗したジョブを検索 */
  async findActiveByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob | null> {
    const stem = path.parse(fileName).name;
    const job = await this.findById(stem);
    if (
      job &&
      (job.status === 'initializing' ||
        job.status === 'splitting' ||
        job.status === 'transcribing' ||
        job.status === 'failed')
    ) {
      return job;
    }
    return null;
  }

  /** ファイル名で全ジョブ（完了・未完了含む）を検索 */
  async findAllJobsByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob[]> {
    const stem = path.parse(fileName).name;
    const job = await this.findById(stem);
    return job ? [job] : [];
  }

  /** 全ジョブ一覧を取得（完了済み含む） */
  async findResumableJobs(): Promise<ChunkedTranscriptionJob[]> {
    if (!existsSync(this.storeDir)) return [];

    const entries = await fs.readdir(this.storeDir, { withFileTypes: true });
    const allJobs: ChunkedTranscriptionJob[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(this.storeDir, entry.name, 'job.json');
      if (!existsSync(filePath)) continue;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        allJobs.push(JSON.parse(content) as ChunkedTranscriptionJob);
      } catch {
        // 読み込み失敗は無視
      }
    }

    // 更新日時の降順でソート
    return allJobs.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /** ジョブとチャンク音声ファイルを削除 */
  async delete(jobId: string): Promise<void> {
    // ジョブフォルダを削除
    const jobDir = this.getJobDir(jobId);
    if (existsSync(jobDir)) {
      await fs.rm(jobDir, { recursive: true, force: true });
      this.logger.log(`ジョブフォルダを削除: ${jobDir}`);
    }

    // チャンク音声ディレクトリを削除
    const chunksDir = path.join(this.getChunksBaseDir(), jobId);
    if (existsSync(chunksDir)) {
      await fs.rm(chunksDir, { recursive: true, force: true });
      this.logger.log(`チャンク音声ディレクトリを削除: ${chunksDir}`);
    }
  }
}
