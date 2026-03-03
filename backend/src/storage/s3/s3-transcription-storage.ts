import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { TranscriptionStorage } from '../interfaces/transcription-storage.interface';
import { Transcription } from '../../transcription/types/transcription.types';

/** S3による文字起こしストレージ実装 */
@Injectable()
export class S3TranscriptionStorage implements TranscriptionStorage {
  private readonly logger = new Logger(S3TranscriptionStorage.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-1'),
    });
    this.bucket = this.configService.get<string>('S3_BUCKET', '');
    this.prefix = this.configService.get<string>(
      'S3_TRANSCRIPTIONS_PREFIX',
      'transcriptions/',
    );
  }

  async save(transcription: Transcription): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.prefix}${transcription.id}.json`,
        Body: JSON.stringify(transcription, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  async findById(id: string): Promise<Transcription | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}${id}.json`,
        }),
      );
      const body = await response.Body!.transformToString('utf-8');
      return JSON.parse(body) as Transcription;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async findAll(): Promise<Transcription[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: this.prefix,
    });
    const response = await this.s3.send(command);
    const transcriptions: Transcription[] = [];

    for (const obj of response.Contents ?? []) {
      if (!obj.Key!.endsWith('.json')) continue;
      try {
        const getResponse = await this.s3.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: obj.Key!,
          }),
        );
        const body = await getResponse.Body!.transformToString('utf-8');
        transcriptions.push(JSON.parse(body) as Transcription);
      } catch (error) {
        this.logger.warn(`S3オブジェクトの読み込みに失敗: ${obj.Key}`, error);
      }
    }

    return transcriptions;
  }
}
