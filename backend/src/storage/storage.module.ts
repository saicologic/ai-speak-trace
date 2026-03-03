import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AUDIO_STORAGE } from './interfaces/audio-storage.interface';
import { TRANSCRIPTION_STORAGE } from './interfaces/transcription-storage.interface';
import { LocalAudioStorage } from './local/local-audio-storage';
import { LocalTranscriptionStorage } from './local/local-transcription-storage';
import { S3AudioStorage } from './s3/s3-audio-storage';
import { S3TranscriptionStorage } from './s3/s3-transcription-storage';

/** S3モードに必要な環境変数を検証する */
function validateS3Config(configService: ConfigService): void {
  const required: { key: string; label: string }[] = [
    { key: 'S3_BUCKET', label: 'S3バケット名' },
    { key: 'AWS_REGION', label: 'AWSリージョン' },
  ];
  const missing = required.filter(
    ({ key }) => !configService.get<string>(key),
  );
  if (missing.length > 0) {
    const details = missing
      .map(({ key, label }) => `  - ${key} (${label})`)
      .join('\n');
    throw new Error(
      `STORAGE_TYPE=s3 が設定されていますが、以下の環境変数が不足しています:\n${details}\nbackend/.env ファイルを確認してください。`,
    );
  }
}

/** ストレージモジュール: STORAGE_TYPE環境変数でローカル/S3を切り替え */
@Global()
@Module({})
export class StorageModule {
  static forRoot(): DynamicModule {
    return {
      module: StorageModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: AUDIO_STORAGE,
          useFactory: (configService: ConfigService) => {
            const storageType = configService.get<string>(
              'STORAGE_TYPE',
              'local',
            );
            if (storageType === 's3') {
              validateS3Config(configService);
              return new S3AudioStorage(configService);
            }
            return new LocalAudioStorage(configService);
          },
          inject: [ConfigService],
        },
        {
          provide: TRANSCRIPTION_STORAGE,
          useFactory: (configService: ConfigService) => {
            const storageType = configService.get<string>(
              'STORAGE_TYPE',
              'local',
            );
            if (storageType === 's3') {
              validateS3Config(configService);
              return new S3TranscriptionStorage(configService);
            }
            return new LocalTranscriptionStorage(configService);
          },
          inject: [ConfigService],
        },
      ],
      exports: [AUDIO_STORAGE, TRANSCRIPTION_STORAGE],
    };
  }
}
