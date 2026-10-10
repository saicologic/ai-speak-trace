import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 文字起こしから作られたログのディレクトリ（DATA_DIR 配下）
 * - analysis-logs: 会話分析（transcriptionId を持つ）
 * - summary-logs: 要約（transcriptionId を持つ）
 * - deep-search-logs: ディープサーチ（transcriptionIds を持つ）
 */
export const DERIVED_LOG_DIRS = [
  'analysis-logs',
  'summary-logs',
  'deep-search-logs',
] as const;

/**
 * 文字起こしを削除したときに、その会話の内容を含むログを削除するサービス
 *
 * ログには会話の抜粋や分析結果が残るため、元の文字起こしだけを消すと、削除したはずの
 * 会話の内容がディスクに残り続ける。文字起こしの削除と同時に、それを使ったログも削除する。
 */
@Injectable()
export class DerivedLogCleaner {
  private readonly logger = new Logger(DerivedLogCleaner.name);
  private readonly dataDir: string;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = path.resolve(
      this.configService.get<string>('DATA_DIR') || './data',
    );
  }

  /** 指定した文字起こしを使ったログを削除し、削除した件数を返す */
  async deleteLogsForTranscription(transcriptionId: string): Promise<number> {
    let deleted = 0;
    for (const dir of DERIVED_LOG_DIRS) {
      const dirPath = path.join(this.dataDir, dir);
      let entries: string[];
      try {
        entries = await fs.readdir(dirPath);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const filePath = path.join(dirPath, name);
        try {
          const log = JSON.parse(await fs.readFile(filePath, 'utf-8')) as {
            transcriptionId?: string;
            transcriptionIds?: string[];
          };
          if (
            log.transcriptionId === transcriptionId ||
            log.transcriptionIds?.includes(transcriptionId)
          ) {
            await fs.rm(filePath, { force: true });
            deleted++;
          }
        } catch (error) {
          this.logger.warn(`ログを確認できません: ${filePath}`, error);
        }
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `文字起こしを使ったログを削除しました: ${transcriptionId}（${deleted}件）`,
      );
    }
    return deleted;
  }
}
