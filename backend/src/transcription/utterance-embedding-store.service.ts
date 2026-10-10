import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

/** 発話ベクトルのキャッシュ（文字起こしごとに1ファイル） */
export interface UtteranceEmbeddingCache {
  modelId: string;
  dimensions: number;
  /** 発話テキストのハッシュ。文字起こしが編集されたら作り直す */
  textsHash: string;
  embeddings: number[][];
}

/**
 * 文字起こしの発話ベクトルをローカルファイルに保存するストア
 * 文字起こしから作った派生データのため、文字起こしの削除時に一緒に削除する
 */
@Injectable()
export class UtteranceEmbeddingStore {
  private readonly logger = new Logger(UtteranceEmbeddingStore.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, 'utterance-embeddings'));
  }

  /** キャッシュファイルのパス（パストラバーサル対策でファイル名部分のみ使う） */
  private getFilePath(transcriptionId: string): string {
    return path.join(this.storeDir, `${path.basename(transcriptionId)}.json`);
  }

  /** キャッシュを読み込む。存在しない・壊れている場合は null */
  async find(transcriptionId: string): Promise<UtteranceEmbeddingCache | null> {
    const filePath = this.getFilePath(transcriptionId);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(
        await fs.readFile(filePath, 'utf-8'),
      ) as UtteranceEmbeddingCache;
    } catch (error) {
      this.logger.warn(
        `発話ベクトルのキャッシュを読めません: ${filePath}`,
        error,
      );
      return null;
    }
  }

  /** キャッシュを保存する（書き込み途中のファイルを読まれないよう、一時ファイルから置き換える） */
  async save(
    transcriptionId: string,
    cache: UtteranceEmbeddingCache,
  ): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.getFilePath(transcriptionId);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(cache), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  /** キャッシュを削除する（存在しなければ何もしない） */
  async delete(transcriptionId: string): Promise<void> {
    await fs.rm(this.getFilePath(transcriptionId), { force: true });
  }
}
