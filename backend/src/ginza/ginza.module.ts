import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { GinzaController } from './ginza.controller';
import { GinzaEnvService } from './ginza-env.service';
import { GinzaKeywordsService } from './ginza-keywords.service';

@Module({
  imports: [ConfigModule, SettingsModule, TranscriptionModule],
  controllers: [GinzaController],
  providers: [GinzaEnvService, GinzaKeywordsService],
})
export class GinzaModule {}
