import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StorageModule } from './storage/storage.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { InterviewModule } from './interview/interview.module';
import { ResearchModule } from './research/research.module';
import { FeedbackModule } from './feedback/feedback.module';
import { SettingsModule } from './settings/settings.module';
import { PodcastModule } from './podcast/podcast.module';
import { GinzaModule } from './ginza/ginza.module';

@Module({
  imports: [
    // 環境変数の読み込み
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    // ストレージモジュール（音声ファイルと文字起こしをローカルに保存）
    StorageModule.forRoot(),
    // 音声ファイルを静的配信
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dataDir = configService.get<string>('DATA_DIR') || './data';
        const audioDir = resolve(
          configService.get<string>('AUDIO_DIR') || `${dataDir}/audio`,
        );
        return [{ rootPath: audioDir, serveRoot: '/audio' }];
      },
      inject: [ConfigService],
    }),
    TranscriptionModule,
    InterviewModule,
    ResearchModule,
    FeedbackModule,
    SettingsModule,
    PodcastModule,
    GinzaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
