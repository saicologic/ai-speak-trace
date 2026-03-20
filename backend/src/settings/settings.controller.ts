import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** 現在の設定を取得 */
  @Get()
  getSettings() {
    return { settings: this.settingsService.getSettings() };
  }

  /** 設定を更新 */
  @Patch()
  updateSettings(
    @Body()
    dto: {
      dataDir?: string;
      elevenlabsApiKey?: string;
      anthropicApiKey?: string;
    },
  ) {
    return this.settingsService.updateSettings(dto);
  }
}
