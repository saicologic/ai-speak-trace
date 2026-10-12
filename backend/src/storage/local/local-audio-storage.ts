import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { AudioStorage } from '../interfaces/audio-storage.interface';
import { AudioFileInfo } from '../../transcription/types/transcription.types';

/** 対応する音声・動画ファイル拡張子 */
const AUDIO_EXTENSIONS = [
  '.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm',
  '.aac', '.aiff', '.opus', '.mp4',
  '.avi', '.mkv', '.mov', '.wmv', '.flv', '.mpeg', '.3gpp',
];

/** ローカルファイルシステムによる音声ストレージ実装 */
@Injectable()
export class LocalAudioStorage implements AudioStorage {
  private readonly logger = new Logger(LocalAudioStorage.name);
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.baseDir = path.resolve(
      this.configService.get<string>('AUDIO_DIR') ||
        path.join(dataDir, 'audio'),
    );
    this.logger.log(`音声ファイルディレクトリ: ${this.baseDir}`);
  }

  async listFiles(): Promise<AudioFileInfo[]> {
    if (!existsSync(this.baseDir)) return [];

    const files = await fs.readdir(this.baseDir);
    const audioFiles: AudioFileInfo[] = [];

    for (const fileName of files) {
      const ext = path.extname(fileName).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;

      const stat = await fs.stat(path.join(this.baseDir, fileName));
      audioFiles.push({
        fileName,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }

    return audioFiles;
  }

  /**
   * ファイル名から音声ディレクトリ内のパスを作る
   * URL から受け取ったファイル名に「../」や「/」が含まれていても、音声ディレクトリの外を指さないようにする
   */
  private resolveFilePath(fileName: string): string {
    if (
      !fileName ||
      fileName !== path.basename(fileName) ||
      fileName.includes('\\') ||
      fileName === '.' ||
      fileName === '..' ||
      fileName.includes('\0')
    ) {
      throw new BadRequestException('音声ファイル名が正しくありません');
    }
    const filePath = path.resolve(this.baseDir, fileName);
    if (path.dirname(filePath) !== this.baseDir) {
      throw new BadRequestException('音声ファイル名が正しくありません');
    }
    return filePath;
  }

  async exists(fileName: string): Promise<boolean> {
    return existsSync(this.resolveFilePath(fileName));
  }

  async readFile(fileName: string): Promise<Buffer> {
    return fs.readFile(this.resolveFilePath(fileName));
  }

  async getPlaybackUrl(fileName: string): Promise<string> {
    // ポートは動的割り当てのためホスト名は返さず、パスのみを返す
    // フロントエンドが BASE_URL と組み合わせて完全なURLを構築する
    return `/audio/${encodeURIComponent(fileName)}`;
  }

  async saveFile(fileName: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolveFilePath(fileName);
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(filePath, buffer);
    this.logger.log(`音声ファイル保存完了: ${fileName}`);
  }

  async deleteFile(fileName: string): Promise<void> {
    const filePath = this.resolveFilePath(fileName);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
      this.logger.log(`音声ファイル削除完了: ${fileName}`);
    }
  }

  /** ServeStaticModule用にbaseDirを公開 */
  getBaseDir(): string {
    return this.baseDir;
  }
}
