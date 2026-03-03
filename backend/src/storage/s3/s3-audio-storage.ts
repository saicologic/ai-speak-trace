import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
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
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-1'),
    });
    this.bucket = this.configService.get<string>('S3_BUCKET', '');
    this.prefix = this.configService.get<string>('S3_AUDIO_PREFIX', 'outputs/');
  }

  async listFiles(): Promise<AudioFileInfo[]> {
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
  }

  async getPlaybackUrl(fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: `${this.prefix}${fileName}`,
    });
    return getSignedUrl(this.s3, command, { expiresIn: 900 });
  }
}
