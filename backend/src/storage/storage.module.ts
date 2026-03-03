import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AUDIO_STORAGE } from './interfaces/audio-storage.interface';
import { TRANSCRIPTION_STORAGE } from './interfaces/transcription-storage.interface';
import { LocalAudioStorage } from './local/local-audio-storage';
import { LocalTranscriptionStorage } from './local/local-transcription-storage';
import { S3AudioStorage } from './s3/s3-audio-storage';
import { S3TranscriptionStorage } from './s3/s3-transcription-storage';

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
