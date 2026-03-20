import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TranscriptionStorage } from '../interfaces/transcription-storage.interface';
import { Transcription } from '../../transcription/types/transcription.types';

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

  async save(transcription: Transcription): Promise<void> {
    const filePath = path.join(this.storeDir, `${transcription.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(transcription, null, 2), 'utf-8');
  }

  async findById(id: string): Promise<Transcription | null> {
    const filePath = path.join(this.storeDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Transcription;
  }

  async findAll(): Promise<Transcription[]> {
    if (!existsSync(this.storeDir)) return [];

    const files = await fs.readdir(this.storeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const transcriptions: Transcription[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(this.storeDir, file),
          'utf-8',
        );
        transcriptions.push(JSON.parse(content) as Transcription);
      } catch (error) {
        this.logger.warn(`JSONファイルの読み込みに失敗: ${file}`, error);
      }
    }

    return transcriptions;
  }
}
