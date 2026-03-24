import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { TranscriptionService } from './transcription.service';
import { TranscriptionJob } from './types/job.types';

/** ジョブのライフサイクル管理サービス */
@Injectable()
export class JobManagerService implements OnModuleInit {
  private readonly logger = new Logger(JobManagerService.name);
  private readonly jobs = new Map<string, TranscriptionJob>();
  private readonly jobsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly transcriptionService: TranscriptionService,
  ) {
    const dataDir =
      this.configService.get<string>('DATA_DIR') || './data';
    this.jobsDir = path.resolve(dataDir, 'jobs');

    if (!existsSync(this.jobsDir)) {
      mkdirSync(this.jobsDir, { recursive: true });
    }

    this.logger.log(`ジョブ保存ディレクトリ: ${this.jobsDir}`);
  }

  /** モジュール初期化時にジョブを読み込み・復旧 */
  async onModuleInit() {
    await this.loadJobs();
  }

  /** ジョブを開始（非ブロッキング） */
  async startJob(audioFileName: string): Promise<TranscriptionJob> {
    const job: TranscriptionJob = {
      id: uuidv4(),
      audioFileName,
      status: 'processing',
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.id, job);
    await this.saveJob(job);

    this.logger.log(`ジョブ開始: ${job.id} (${audioFileName})`);

    // バックグラウンドで文字起こし実行（awaitしない）
    this.runTranscription(job);

    return job;
  }

  /** ジョブを取得 */
  getJob(id: string): TranscriptionJob | undefined {
    return this.jobs.get(id);
  }

  /** 全ジョブを取得 */
  getAllJobs(): TranscriptionJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** アクティブ（処理中）ジョブを取得 */
  getActiveJobs(): TranscriptionJob[] {
    return this.getAllJobs().filter((j) => j.status === 'processing');
  }

  /** ジョブを削除 */
  async deleteJob(id: string): Promise<void> {
    this.jobs.delete(id);
    const filePath = path.join(this.jobsDir, `${id}.json`);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
    this.logger.log(`ジョブ削除: ${id}`);
  }

  /** バックグラウンドで文字起こしを実行 */
  private async runTranscription(job: TranscriptionJob): Promise<void> {
    try {
      const transcription = await this.transcriptionService.transcribe(
        job.audioFileName,
      );
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.transcriptionId = transcription.id;
      this.logger.log(
        `ジョブ完了: ${job.id} (transcriptionId: ${transcription.id})`,
      );
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`ジョブ失敗: ${job.id} - ${job.errorMessage}`);
    }

    await this.saveJob(job);
  }

  /** ジョブを個別ファイルに保存 */
  private async saveJob(job: TranscriptionJob): Promise<void> {
    const filePath = path.join(this.jobsDir, `${job.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
  }

  /** ディレクトリからジョブを読み込み・復旧 */
  private async loadJobs(): Promise<void> {
    if (!existsSync(this.jobsDir)) {
      this.logger.log('ジョブディレクトリが存在しません。新規作成します。');
      return;
    }

    try {
      const files = await fs.readdir(this.jobsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.jobsDir, file),
            'utf-8',
          );
          const job: TranscriptionJob = JSON.parse(content);

          // 処理中だったジョブはアプリ再起動により中断されたとしてfailedにマーク
          if (job.status === 'processing') {
            job.status = 'failed';
            job.completedAt = new Date().toISOString();
            job.errorMessage = 'アプリ再起動により中断されました';
            await this.saveJob(job);
            this.logger.warn(`中断ジョブを検出: ${job.id} (${job.audioFileName})`);
          }

          this.jobs.set(job.id, job);
        } catch (err) {
          this.logger.warn(`ジョブファイルの読み込みに失敗: ${file}`, err);
        }
      }

      this.logger.log(`ジョブ読み込み完了: ${this.jobs.size}件`);
    } catch (error) {
      this.logger.warn('ジョブディレクトリの読み込みに失敗しました', error);
    }
  }
}
