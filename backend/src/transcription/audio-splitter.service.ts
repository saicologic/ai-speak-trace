import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';

const execFileAsync = promisify(execFile);

/** チャンクあたりのデフォルト秒数（10分） */
export const DEFAULT_CHUNK_DURATION_SEC = 600;

/** ffmpegによる音声ファイル分割サービス */
@Injectable()
export class AudioSplitterService {
  private readonly logger = new Logger(AudioSplitterService.name);

  /** ffmpegがインストールされているか確認 */
  async checkFfmpegAvailable(): Promise<boolean> {
    try {
      await execFileAsync('ffmpeg', ['-version']);
      return true;
    } catch {
      return false;
    }
  }

  /** ffprobeで音声ファイルの長さ（秒）を取得 */
  async getAudioDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath,
      ]);
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration)) {
        throw new Error(`音声ファイルの長さを解析できません: ${stdout.trim()}`);
      }
      return duration;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error(
          'ffprobeが見つかりません。ffmpegをインストールしてください: brew install ffmpeg',
        );
      }
      throw error;
    }
  }

  /**
   * 音声ファイルをチャンク分割する
   * @param inputBuffer 入力音声のBuffer
   * @param fileName 元のファイル名（拡張子の判定に使用）
   * @param chunkDurationSec チャンクあたりの秒数
   * @param outputDir 出力先ディレクトリ
   * @returns チャンクファイルパスの配列と総秒数
   */
  async splitAudio(
    inputBuffer: Buffer,
    fileName: string,
    chunkDurationSec: number,
    outputDir: string,
  ): Promise<{ chunkFiles: string[]; totalDurationSec: number }> {
    // ffmpegの存在確認
    if (!(await this.checkFfmpegAvailable())) {
      throw new Error(
        'ffmpegがインストールされていません。Homebrew等でインストールしてください: brew install ffmpeg',
      );
    }

    // 出力ディレクトリを作成
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // 入力ファイルを一時ファイルとして書き出し
    const ext = path.extname(fileName) || '.m4a';
    const sourcePath = path.join(outputDir, `source${ext}`);
    await fs.writeFile(sourcePath, inputBuffer);
    this.logger.log(`一時ファイル書き出し完了: ${sourcePath}`);

    // 音声の長さを取得
    const totalDurationSec = await this.getAudioDuration(sourcePath);
    const totalChunks = Math.ceil(totalDurationSec / chunkDurationSec);
    this.logger.log(
      `音声分割開始: ${totalDurationSec.toFixed(1)}秒 → ${totalChunks}チャンク (${chunkDurationSec}秒/チャンク)`,
    );

    // チャンクごとにffmpegで分割
    const chunkFiles: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const startSec = i * chunkDurationSec;
      const chunkFileName = `chunk_${String(i).padStart(3, '0')}${ext}`;
      const chunkPath = path.join(outputDir, chunkFileName);

      await execFileAsync('ffmpeg', [
        '-y',                          // 既存ファイルを上書き
        '-ss', String(startSec),       // 開始位置
        '-t', String(chunkDurationSec), // 切り出す長さ
        '-i', sourcePath,              // 入力ファイル
        '-c', 'copy',                  // コーデックコピー（再エンコードなし）
        chunkPath,                     // 出力ファイル
      ]);

      chunkFiles.push(chunkPath);
      this.logger.log(
        `チャンク ${i + 1}/${totalChunks} 分割完了: ${chunkFileName}`,
      );
    }

    // ソースファイルを削除（チャンクのみ残す）
    await fs.unlink(sourcePath);

    return { chunkFiles, totalDurationSec };
  }

  /** チャンクディレクトリを削除してクリーンアップ */
  async cleanupChunks(outputDir: string): Promise<void> {
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
      this.logger.log(`チャンクファイル削除完了: ${outputDir}`);
    } catch (error) {
      this.logger.warn(
        `チャンクファイルの削除に失敗: ${outputDir}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
