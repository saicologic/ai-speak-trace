import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Transcription } from './types/transcription.types';

/** 文字起こし結果をJSONファイルで永続化するサービス */
@Injectable()
export class TranscriptionStoreService {
  private readonly logger = new Logger(TranscriptionStoreService.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    this.storeDir = path.resolve(
      this.configService.get<string>('TRANSCRIPTIONS_DIR') ||
        path.join(__dirname, '..', '..', '..', 'transcriptions'),
    );

    // ディレクトリが存在しなければ作成
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
      this.logger.log(`保存ディレクトリを作成しました: ${this.storeDir}`);
    }
  }

  /** 文字起こし結果を保存 */
  async save(transcription: Transcription): Promise<void> {
    const filePath = path.join(this.storeDir, `${transcription.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(transcription, null, 2), 'utf-8');
    this.logger.log(`保存完了: ${filePath}`);
  }

  /** IDで文字起こし結果を取得 */
  async findById(id: string): Promise<Transcription | null> {
    const filePath = path.join(this.storeDir, `${id}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Transcription;
  }

  /** 全文字起こし結果を取得 */
  async findAll(): Promise<Transcription[]> {
    if (!existsSync(this.storeDir)) {
      return [];
    }

    const files = await fs.readdir(this.storeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const transcriptions: Transcription[] = [];
    for (const file of jsonFiles) {
      const content = await fs.readFile(
        path.join(this.storeDir, file),
        'utf-8',
      );
      transcriptions.push(JSON.parse(content) as Transcription);
    }

    return transcriptions;
  }
}
