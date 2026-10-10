import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { DeepSearchLog, DeepSearchLogSummary } from './types/deep-search.types';

/** ディープサーチログをローカルファイルに保存・取得するサービス */
@Injectable()
export class DeepSearchLogStorage {
  private readonly logger = new Logger(DeepSearchLogStorage.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, 'deep-search-logs'));

    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
    this.logger.log(`ディープサーチログ保存ディレクトリ: ${this.storeDir}`);
  }

  /** ログファイルパスを取得 */
  private getFilePath(id: string): string {
    // パストラバーサル対策: ファイル名部分のみを使う
    return path.join(this.storeDir, `${path.basename(id)}.json`);
  }

  /** ログを保存（同じIDは上書き） */
  async save(log: DeepSearchLog): Promise<void> {
    await fs.writeFile(
      this.getFilePath(log.id),
      JSON.stringify(log, null, 2),
      'utf-8',
    );
    this.logger.log(`ディープサーチログ保存完了: ${log.id}`);
  }

  /** IDでログを取得 */
  async findById(id: string): Promise<DeepSearchLog | null> {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as DeepSearchLog;
  }

  /** 全ログをsearchedAt降順で取得（結果本文と分析本文を除いたサマリー） */
  async findAllSummaries(): Promise<DeepSearchLogSummary[]> {
    if (!existsSync(this.storeDir)) return [];

    const entries = await fs.readdir(this.storeDir, { withFileTypes: true });
    const summaries: DeepSearchLogSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, entry.name),
          'utf-8',
        );
        const { results, analysis, ...rest } = JSON.parse(
          content,
        ) as DeepSearchLog;
        summaries.push({
          ...rest,
          resultCount: results.length,
          analyzed: analysis !== undefined,
        });
      } catch (error) {
        this.logger.warn(
          `ディープサーチログの読み込みに失敗: ${entry.name}`,
          error,
        );
      }
    }

    summaries.sort(
      (a, b) =>
        new Date(b.searchedAt).getTime() - new Date(a.searchedAt).getTime(),
    );
    return summaries;
  }
}
