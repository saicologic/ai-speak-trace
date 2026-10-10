import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 文字起こしから作られたログのディレクトリ（DATA_DIR 配下）
 * - analysis-logs: 会話分析（transcriptionId を持つ）
 * - summary-logs: 要約（transcriptionId を持つ）
 * - deep-search-logs: ディープサーチ（transcriptionIds を持つ）
 * - research-jobs: ディープサーチの調査（transcriptionIds を持つ）
 */
export const DERIVED_LOG_DIRS = [
  'analysis-logs',
  'summary-logs',
  'deep-search-logs',
  'research-jobs',
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

  /**
   * 指定した文字起こしを使ったログを削除し、削除した件数を返す
   * 読み込みや削除に失敗したログがある場合は、削除が完了していないため例外を投げる
   * （呼び出し元はやり直せるよう、元の文字起こしを残す）
   */
  async deleteLogsForTranscription(transcriptionId: string): Promise<number> {
    let deleted = 0;
    const failures: string[] = [];
    for (const dir of DERIVED_LOG_DIRS) {
      const dirPath = path.join(this.dataDir, dir);
      let entries: string[];
      try {
        entries = await fs.readdir(dirPath);
      } catch (error) {
        // ディレクトリがない（ログが1件もない）場合だけ許容する
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        failures.push(dirPath);
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const filePath = path.join(dirPath, name);
        let log: unknown;
        try {
          log = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (error) {
          // 壊れたログはどの文字起こしのものか判断できない。関係のない文字起こしの削除まで
          // 止めないよう、警告して残す
          this.logger.warn(
            `ログを読めないため確認できません: ${filePath}`,
            error,
          );
          continue;
        }
        if (!referencesTranscription(log, transcriptionId)) continue;
        try {
          await fs.rm(filePath, { force: true });
          deleted++;
        } catch (error) {
          this.logger.warn(`ログを削除できません: ${filePath}`, error);
          failures.push(filePath);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `文字起こしを使ったログを削除できませんでした（${failures.length}件）: ${failures.join(', ')}`,
      );
    }
    if (deleted > 0) {
      this.logger.log(
        `文字起こしを使ったログを削除しました: ${transcriptionId}（${deleted}件）`,
      );
    }
    return deleted;
  }
}

/** ログが指定した文字起こしを使っているか（想定外の形のログは「使っていない」とみなす） */
function referencesTranscription(
  log: unknown,
  transcriptionId: string,
): boolean {
  if (typeof log !== 'object' || log === null) return false;
  const { transcriptionId: id, transcriptionIds: ids } = log as Record<
    string,
    unknown
  >;
  return (
    id === transcriptionId ||
    (Array.isArray(ids) && ids.includes(transcriptionId))
  );
}
