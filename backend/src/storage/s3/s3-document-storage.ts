import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { DocumentStorage } from '../interfaces/document-storage.interface';
import { DocumentMetadata } from '../../document/types/document.types';

/** S3によるドキュメントストレージ実装 */
@Injectable()
export class S3DocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(S3DocumentStorage.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly documentsPrefix: string;
  private readonly metadataPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-1',
    );
    this.bucket = this.configService.get<string>('S3_BUCKET', '');
    this.documentsPrefix = this.configService.get<string>(
      'S3_DOCUMENTS_PREFIX',
      'documents/',
    );
    this.metadataPrefix = this.configService.get<string>(
      'S3_DOCUMENT_METADATA_PREFIX',
      'document-metadata/',
    );

    if (!this.bucket) {
      throw new Error(
        'S3_BUCKET が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    this.s3 = new S3Client({ region });
    this.logger.log(
      `S3ドキュメントストレージ初期化: bucket=${this.bucket}`,
    );
  }

  async saveFile(id: string, fileName: string, buffer: Buffer): Promise<void> {
    const ext = fileName.substring(fileName.lastIndexOf('.'));
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.documentsPrefix}${id}${ext}`,
        Body: buffer,
        ContentType: 'application/pdf',
      }),
    );
  }

  async readFile(id: string): Promise<Buffer> {
    // PDFファイルを検索
    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.documentsPrefix}${id}`,
        MaxKeys: 1,
      }),
    );
    const key = response.Contents?.[0]?.Key;
    if (!key) {
      throw new Error(`S3上にドキュメントが見つかりません: ${id}`);
    }

    const getResponse = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of getResponse.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async deleteFile(id: string): Promise<void> {
    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.documentsPrefix}${id}`,
        MaxKeys: 1,
      }),
    );
    const key = response.Contents?.[0]?.Key;
    if (key) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    }
  }

  async saveMetadata(metadata: DocumentMetadata): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.metadataPrefix}${metadata.id}.json`,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  async findMetadataById(id: string): Promise<DocumentMetadata | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${this.metadataPrefix}${id}.json`,
        }),
      );
      const body = await response.Body!.transformToString('utf-8');
      return JSON.parse(body) as DocumentMetadata;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      this.logger.error(`メタデータの取得に失敗: ${id}`, err);
      throw new Error(`メタデータの取得に失敗しました（${id}）: ${err.message}`);
    }
  }

  async findAllMetadata(): Promise<DocumentMetadata[]> {
    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.metadataPrefix,
      }),
    );
    const metadata: DocumentMetadata[] = [];

    for (const obj of response.Contents ?? []) {
      if (!obj.Key!.endsWith('.json')) continue;
      try {
        const getResponse = await this.s3.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key! }),
        );
        const body = await getResponse.Body!.transformToString('utf-8');
        metadata.push(JSON.parse(body) as DocumentMetadata);
      } catch (error) {
        this.logger.warn(`S3メタデータの読み込みに失敗: ${obj.Key}`, error);
      }
    }

    return metadata;
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `${this.metadataPrefix}${id}.json`,
      }),
    );
  }
}
