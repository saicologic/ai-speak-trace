import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AudioStorage } from '../interfaces/audio-storage.interface';
import { AudioFileInfo } from '../../transcription/types/transcription.types';

/** 対応する音声・動画ファイル拡張子 */
const AUDIO_EXTENSIONS = [
  '.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm',
  '.aac', '.aiff', '.opus', '.mp4',
  '.avi', '.mkv', '.mov', '.wmv', '.flv', '.mpeg', '.3gpp',
];

/** S3による音声ストレージ実装 */
@Injectable()
export class S3AudioStorage implements AudioStorage {
  private readonly logger = new Logger(S3AudioStorage.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION', 'ap-northeast-1');
    this.bucket = this.configService.get<string>('S3_BUCKET', '');
    this.prefix = this.configService.get<string>('S3_AUDIO_PREFIX', 'outputs/');

    if (!this.bucket) {
      throw new Error(
        'S3_BUCKET が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    this.s3 = new S3Client({ region });
    this.logger.log(`S3音声ストレージ初期化: bucket=${this.bucket}, prefix=${this.prefix}`);
  }

  async listFiles(): Promise<AudioFileInfo[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.prefix,
      });
      const response = await this.s3.send(command);
      const audioFiles: AudioFileInfo[] = [];

      for (const obj of response.Contents ?? []) {
        const fileName = obj.Key!.replace(this.prefix, '');
        if (!fileName) continue;
        const hasAudioExt = AUDIO_EXTENSIONS.some((ext) =>
          fileName.toLowerCase().endsWith(ext),
        );
        if (!hasAudioExt) continue;

        audioFiles.push({
          fileName,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified?.toISOString() ?? '',
        });
      }

      return audioFiles;
    } catch (err: any) {
      this.logger.error(`S3音声ファイル一覧の取得に失敗`, err);
      throw new Error(
        `S3からの音声ファイル一覧取得に失敗しました（bucket: ${this.bucket}）: ${err.message}`,
      );
    }
  }

  async exists(fileName: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}${fileName}`,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async readFile(fileName: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.prefix}${fileName}`,
      });
      const response = await this.s3.send(command);
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      this.logger.error(`S3音声ファイルの読み込みに失敗: ${fileName}`, err);
      throw new Error(
        `S3からの音声ファイル読み込みに失敗しました（${fileName}）: ${err.message}`,
      );
    }
  }

  async getPlaybackUrl(fileName: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.prefix}${fileName}`,
      });
      return await getSignedUrl(this.s3, command, { expiresIn: 900 });
    } catch (err: any) {
      this.logger.error(`S3署名付きURL生成に失敗: ${fileName}`, err);
      throw new Error(
        `S3署名付きURLの生成に失敗しました（${fileName}）: ${err.message}`,
      );
    }
  }

  async getUploadUrl(fileName: string): Promise<string | null> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.prefix}${fileName}`,
      });
      return await getSignedUrl(this.s3, command, { expiresIn: 900 });
    } catch (err: any) {
      this.logger.error(`S3アップロード用署名付きURL生成に失敗: ${fileName}`, err);
      throw new Error(
        `S3アップロード用署名付きURLの生成に失敗しました（${fileName}）: ${err.message}`,
      );
    }
  }

  async saveFile(fileName: string, buffer: Buffer): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}${fileName}`,
          Body: buffer,
        }),
      );
      this.logger.log(`S3音声ファイル保存完了: ${fileName}`);
    } catch (err: any) {
      this.logger.error(`S3への音声ファイル保存に失敗: ${fileName}`, err);
      throw new Error(
        `S3への音声ファイル保存に失敗しました（${fileName}）: ${err.message}`,
      );
    }
  }

  async deleteFile(fileName: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: `${this.prefix}${fileName}`,
        }),
      );
      this.logger.log(`S3音声ファイル削除完了: ${fileName}`);
    } catch (err: any) {
      this.logger.error(`S3からの音声ファイル削除に失敗: ${fileName}`, err);
      throw new Error(
        `S3からの音声ファイル削除に失敗しました（${fileName}）: ${err.message}`,
      );
    }
  }
}
