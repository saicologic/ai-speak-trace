import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { InterviewAnalysis } from './types/interview.types';

/** 会話分析ログをローカルファイルに保存・取得するサービス */
@Injectable()
export class AnalysisLogStorage {
  private readonly logger = new Logger(AnalysisLogStorage.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, 'analysis-logs'));

    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
    this.logger.log(`分析ログ保存ディレクトリ: ${this.storeDir}`);
  }

  /** ログファイルパスを取得 */
  private getFilePath(id: string): string {
    return path.join(this.storeDir, `${id}.json`);
  }

  /** 分析結果を保存 */
  async save(analysis: InterviewAnalysis): Promise<void> {
    const filePath = this.getFilePath(analysis.id);
    await fs.writeFile(filePath, JSON.stringify(analysis, null, 2), 'utf-8');
    this.logger.log(`分析ログ保存完了: ${analysis.id}`);
  }

  /** IDで分析結果を取得 */
  async findById(id: string): Promise<InterviewAnalysis | null> {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as InterviewAnalysis;
  }

  /** 全分析ログをcreatedAt降順で取得（resultsを除いたサマリー） */
  async findAllSummaries(): Promise<Omit<InterviewAnalysis, 'results'>[]> {
    if (!existsSync(this.storeDir)) return [];

    const entries = await fs.readdir(this.storeDir, { withFileTypes: true });
    const summaries: Omit<InterviewAnalysis, 'results'>[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, entry.name),
          'utf-8',
        );
        const log = JSON.parse(content) as InterviewAnalysis;
        // resultsを除いたサマリーのみ返す
        const { results: _, ...summary } = log;
        summaries.push(summary);
      } catch (error) {
        this.logger.warn(
          `分析ログの読み込みに失敗: ${entry.name}`,
          error,
        );
      }
    }

    // createdAt降順で返す
    summaries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    this.logger.log(`分析ログ一覧取得完了: ${summaries.length}件`);
    return summaries;
  }
}
