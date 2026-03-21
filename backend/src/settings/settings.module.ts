import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [ConfigModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
