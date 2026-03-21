import { Injectable, Logger } from '@nestjs/common';
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
      this.configService.get<string>('OUTPUTS_DIR') ||
        path.join(dataDir, 'outputs'),
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

  async exists(fileName: string): Promise<boolean> {
    return existsSync(path.join(this.baseDir, fileName));
  }

  async readFile(fileName: string): Promise<Buffer> {
    return fs.readFile(path.join(this.baseDir, fileName));
  }

  async getPlaybackUrl(fileName: string): Promise<string> {
    const port = process.env.BACKEND_PORT ?? 3100;
    return `http://localhost:${port}/outputs/${encodeURIComponent(fileName)}`;
  }

  async getUploadUrl(): Promise<string | null> {
    return null;
  }

  async saveFile(fileName: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(path.join(this.baseDir, fileName), buffer);
    this.logger.log(`音声ファイル保存完了: ${fileName}`);
  }

  /** ServeStaticModule用にbaseDirを公開 */
  getBaseDir(): string {
    return this.baseDir;
  }
}
