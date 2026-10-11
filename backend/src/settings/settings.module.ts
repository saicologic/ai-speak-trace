import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  imports: [ConfigModule, PrivacyModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
