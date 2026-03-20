import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StorageModule } from './storage/storage.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { InterviewModule } from './interview/interview.module';
import { DocumentModule } from './document/document.module';
import { DeepSearchModule } from './deep-search/deep-search.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    // 環境変数の読み込み
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    // ストレージモジュール（STORAGE_TYPEでローカル/S3を切り替え）
    StorageModule.forRoot(),
    // ローカルモード時のみ音声ファイルを静的配信
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const storageType = configService.get<string>('STORAGE_TYPE', 'local');
        if (storageType === 's3') {
          return [];
        }
        const dataDir = configService.get<string>('DATA_DIR') || './data';
        const outputsDir = resolve(
          configService.get<string>('OUTPUTS_DIR') ||
            `${dataDir}/outputs`,
        );
        return [{ rootPath: outputsDir, serveRoot: '/outputs' }];
      },
      inject: [ConfigService],
    }),
    TranscriptionModule,
    InterviewModule,
    DocumentModule,
    DeepSearchModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
