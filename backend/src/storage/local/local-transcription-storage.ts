import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TranscriptionStorage } from '../interfaces/transcription-storage.interface';
import { Transcription } from '../../transcription/types/transcription.types';
import {
  TRANSCRIPTION_FILE,
  listTranscriptionIds,
  readTranscriptionFile,
} from './transcription-files';

/** ローカルファイルシステムによる文字起こしストレージ実装 */
@Injectable()
export class LocalTranscriptionStorage implements TranscriptionStorage {
  private readonly logger = new Logger(LocalTranscriptionStorage.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(
      this.configService.get<string>('TRANSCRIPTIONS_DIR') ||
        path.join(dataDir, 'transcriptions'),
    );

    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
    this.logger.log(`文字起こし保存ディレクトリ: ${this.storeDir}`);
  }

  /** IDからサブフォルダパスを取得 */
  private getItemDir(id: string): string {
    return path.join(this.storeDir, id);
  }

  async save(transcription: Transcription): Promise<void> {
    const itemDir = this.getItemDir(transcription.id);
    await fs.mkdir(itemDir, { recursive: true });
    await fs.writeFile(
      path.join(itemDir, TRANSCRIPTION_FILE),
      JSON.stringify(transcription, null, 2),
      'utf-8',
    );
  }

  async findById(id: string): Promise<Transcription | null> {
    return readTranscriptionFile(this.storeDir, id);
  }

  async findAll(): Promise<Transcription[]> {
    this.logger.log(`findAll 開始: storeDir=${this.storeDir}`);

    if (!existsSync(this.storeDir)) {
      this.logger.warn(`保存ディレクトリが存在しません: ${this.storeDir}`);
      return [];
    }

    const transcriptions: Transcription[] = [];
    for (const id of await listTranscriptionIds(this.storeDir)) {
      try {
        const transcription = await readTranscriptionFile(this.storeDir, id);
        if (transcription) transcriptions.push(transcription);
      } catch (error) {
        this.logger.warn(`JSONファイルの読み込みに失敗: ${id}`, error);
      }
    }

    this.logger.log(
      `findAll 完了: ${transcriptions.length}件の文字起こしを返却`,
    );
    return transcriptions;
  }

  async delete(id: string): Promise<void> {
    const itemDir = this.getItemDir(id);
    if (existsSync(itemDir)) {
      await fs.rm(itemDir, { recursive: true, force: true });
      this.logger.log(`文字起こし結果削除完了: ${id}`);
    }
  }
}
