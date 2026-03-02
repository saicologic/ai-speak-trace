import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TranscriptionModule } from './transcription/transcription.module';
import { InterviewModule } from './interview/interview.module';

@Module({
  imports: [
    // 環境変数の読み込み
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    // 音声ファイルの静的配信（/outputs/filename.wav でアクセス可能）
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'outputs'),
      serveRoot: '/outputs',
    }),
    TranscriptionModule,
    InterviewModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
