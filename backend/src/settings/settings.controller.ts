import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { exec } from 'child_process';

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
      enableAiAnalysis?: boolean;
      enableGinzaKeywords?: boolean;
      bedrockGuardrailId?: string;
      bedrockGuardrailVersion?: string;
      awsProfile?: string;
    },
  ) {
    return this.settingsService.updateSettings(dto);
  }

  /** Guardrail の根拠の確認の tier（STANDARD・CLASSIC・NONE・UNKNOWN） */
  @Get('grounding-tier')
  getGroundingTier() {
    return this.settingsService.getGroundingTier();
  }

  /** Guardrail の根拠の確認を Standard tier にする（画面で確かめてから呼ぶ） */
  @Post('grounding-tier/standard')
  switchGroundingToStandard() {
    return this.settingsService.switchGroundingToStandard();
  }

  /** データフォルダをFinderで開く */
  @Post('open-folder')
  openFolder() {
    const settings = this.settingsService.getSettings();
    const dataDir = settings.paths.dataDir;
    exec(`open "${dataDir}"`);
    return { ok: true };
  }
}
