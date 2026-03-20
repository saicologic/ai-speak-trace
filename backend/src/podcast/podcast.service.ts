import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

/** Podcastキャッシュファイル情報 */
export interface PodcastFileInfo {
  /** ファイル名（UUID.mp3形式） */
  fileName: string;
  /** ファイルサイズ（バイト） */
  sizeBytes: number;
  /** 最終更新日時 */
  lastModified: string;
}

/** 対応する音声ファイル拡張子 */
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg'];

/** Apple Podcastsキャッシュフォルダの相対パス */
const PODCAST_CACHE_RELATIVE_PATH =
  'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache';

@Injectable()
export class PodcastService {
  private readonly logger = new Logger(PodcastService.name);
  private readonly podcastCacheDir: string;

  constructor() {
    // 環境変数 PODCAST_CACHE_DIR が設定されていればそちらを優先
    this.podcastCacheDir =
      process.env.PODCAST_CACHE_DIR ||
      path.join(homedir(), PODCAST_CACHE_RELATIVE_PATH);
    this.logger.log(`Podcastキャッシュディレクトリ: ${this.podcastCacheDir}`);
    this.logger.log(`存在確認: ${existsSync(this.podcastCacheDir)}`);
  }

  /** デバッグ用: キャッシュディレクトリのパスを返す */
  getCacheDir(): string {
    return this.podcastCacheDir;
  }

  /** Podcastキャッシュフォルダの存在確認 */
  exists(): boolean {
    return existsSync(this.podcastCacheDir);
  }

  /** Podcastキャッシュフォルダ内の音声ファイル一覧を取得 */
  async listFiles(): Promise<PodcastFileInfo[]> {
    if (!this.exists()) {
      return [];
    }

    const entries = await fs.readdir(this.podcastCacheDir);
    const files: PodcastFileInfo[] = [];

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;

      const filePath = path.join(this.podcastCacheDir, entry);
      const stat = await fs.stat(filePath);
      files.push({
        fileName: entry,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }

    // 最終更新日時の降順でソート
    return files.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() -
        new Date(a.lastModified).getTime(),
    );
  }

  /** 指定ファイルのBufferを読み込み */
  async readFile(fileName: string): Promise<Buffer> {
    const filePath = path.join(this.podcastCacheDir, fileName);
    if (!existsSync(filePath)) {
      throw new NotFoundException(
        `Podcastファイルが見つかりません: ${fileName}`,
      );
    }
    return fs.readFile(filePath);
  }
}
