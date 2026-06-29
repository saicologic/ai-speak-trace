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

  /**
   * 使用するffmpegバイナリのパスを返す
   * 環境変数 FFMPEG_PATH が設定されている場合はそちらを優先（Tauriバンドル時）
   */
  private getFfmpegPath(): string {
    return process.env.FFMPEG_PATH ?? 'ffmpeg';
  }

  /** ffmpegが利用可能か確認 */
  async checkFfmpegAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.getFfmpegPath(), ['-version']);
      return true;
    } catch {
      return false;
    }
  }

  /** ffmpegで音声ファイルの長さ（秒）を取得（ffprobe不要） */
  async getAudioDuration(filePath: string): Promise<number> {
    const ffmpegPath = this.getFfmpegPath();
    try {
      // ffmpegは-i指定のみだとexit code 1になるがstderrにduration情報が出る
      const { stderr } = await execFileAsync(ffmpegPath, [
        '-i', filePath,
      ]).catch((err: { stderr?: string; code?: number }) => {
        // exit code 1は正常（入力のみ指定時の期待動作）
        if (err.stderr) return { stderr: err.stderr };
        throw err;
      }) as { stderr: string };

      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!match) {
        throw new Error(`音声ファイルの長さを解析できません: ${filePath}`);
      }
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error('ffmpegが見つかりません');
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
    const ffmpegPath = this.getFfmpegPath();

    if (!(await this.checkFfmpegAvailable())) {
      throw new Error('ffmpegが見つかりません');
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

      await execFileAsync(ffmpegPath, [
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
