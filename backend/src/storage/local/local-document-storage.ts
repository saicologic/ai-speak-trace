import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { DocumentStorage } from '../interfaces/document-storage.interface';
import { DocumentMetadata } from '../../document/types/document.types';

/** ローカルファイルシステムによるドキュメントストレージ実装 */
@Injectable()
export class LocalDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(LocalDocumentStorage.name);
  private readonly fileDir: string;
  private readonly metadataDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.fileDir = path.resolve(
      this.configService.get<string>('DOCUMENTS_DIR') ||
        path.join(dataDir, 'documents'),
    );
    this.metadataDir = path.resolve(
      this.configService.get<string>('DOCUMENT_METADATA_DIR') ||
        path.join(dataDir, 'document-metadata'),
    );

    if (!existsSync(this.fileDir)) {
      mkdirSync(this.fileDir, { recursive: true });
    }
    if (!existsSync(this.metadataDir)) {
      mkdirSync(this.metadataDir, { recursive: true });
    }
    this.logger.log(`ドキュメント保存ディレクトリ: ${this.fileDir}`);
    this.logger.log(`メタデータ保存ディレクトリ: ${this.metadataDir}`);
  }

  async saveFile(id: string, fileName: string, buffer: Buffer): Promise<void> {
    const ext = path.extname(fileName);
    const filePath = path.join(this.fileDir, `${id}${ext}`);
    await fs.writeFile(filePath, buffer);
  }

  async readFile(id: string): Promise<Buffer> {
    const files = await fs.readdir(this.fileDir);
    const match = files.find((f) => f.startsWith(id));
    if (!match) {
      throw new Error(`ドキュメントファイルが見つかりません: ${id}`);
    }
    return fs.readFile(path.join(this.fileDir, match));
  }

  async deleteFile(id: string): Promise<void> {
    const files = await fs.readdir(this.fileDir);
    const match = files.find((f) => f.startsWith(id));
    if (match) {
      await fs.unlink(path.join(this.fileDir, match));
    }
  }

  async saveMetadata(metadata: DocumentMetadata): Promise<void> {
    const filePath = path.join(this.metadataDir, `${metadata.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  async findMetadataById(id: string): Promise<DocumentMetadata | null> {
    const filePath = path.join(this.metadataDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as DocumentMetadata;
  }

  async findAllMetadata(): Promise<DocumentMetadata[]> {
    if (!existsSync(this.metadataDir)) return [];

    const files = await fs.readdir(this.metadataDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const metadata: DocumentMetadata[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(this.metadataDir, file),
          'utf-8',
        );
        metadata.push(JSON.parse(content) as DocumentMetadata);
      } catch (error) {
        this.logger.warn(`メタデータの読み込みに失敗: ${file}`, error);
      }
    }

    return metadata;
  }

  async deleteMetadata(id: string): Promise<void> {
    const filePath = path.join(this.metadataDir, `${id}.json`);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }
}
