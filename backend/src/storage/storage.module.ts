import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AUDIO_STORAGE } from './interfaces/audio-storage.interface';
import { TRANSCRIPTION_STORAGE } from './interfaces/transcription-storage.interface';
import { LocalAudioStorage } from './local/local-audio-storage';
import { LocalTranscriptionStorage } from './local/local-transcription-storage';

/** ストレージモジュール: 音声ファイルと文字起こしをローカルに保存する */
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
          useFactory: (configService: ConfigService) =>
            new LocalAudioStorage(configService),
          inject: [ConfigService],
        },
        {
          provide: TRANSCRIPTION_STORAGE,
          useFactory: (configService: ConfigService) =>
            new LocalTranscriptionStorage(configService),
          inject: [ConfigService],
        },
      ],
      exports: [AUDIO_STORAGE, TRANSCRIPTION_STORAGE],
    };
  }
}
