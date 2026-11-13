import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** テスト用の設定データ */
const sampleSettings = {
  paths: {
    dataDir: '/tmp/test-data',
    audioDir: '/tmp/test-data/audio',
    transcriptionsDir: '/tmp/test-data/transcriptions',
  },
  elevenlabsApiKey: 'el-key',
  anthropicApiKey: 'ant-key',
  enableAiAnalysis: true,
};

describe('SettingsController', () => {
  let controller: SettingsController;
  let settingsService: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: SettingsService,
          useValue: {
            getSettings: jest.fn(),
            updateSettings: jest.fn(),
            getGroundingTier: jest.fn(),
            switchGroundingToStandard: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    settingsService = module.get(SettingsService);
  });

  describe('getSettings', () => {
    it('現在の設定をsettingsキーでラップして返す', () => {
      settingsService.getSettings.mockReturnValue(sampleSettings as any);

      const result = controller.getSettings();

      expect(result).toEqual({ settings: sampleSettings });
    });
  });

  describe('updateSettings', () => {
    it('設定を更新して返す', () => {
      const updated = { ...sampleSettings, enableAiAnalysis: false };
      settingsService.updateSettings.mockReturnValue(updated as any);

      const result = controller.updateSettings({ enableAiAnalysis: false });

      expect(settingsService.updateSettings).toHaveBeenCalledWith({
        enableAiAnalysis: false,
      });
      expect(result).toEqual(updated);
    });

    it('一部のフィールドのみ更新できる', () => {
      settingsService.updateSettings.mockReturnValue(sampleSettings as any);

      controller.updateSettings({ elevenlabsApiKey: 'new-key' });

      expect(settingsService.updateSettings).toHaveBeenCalledWith({
        elevenlabsApiKey: 'new-key',
      });
    });
  });

  describe('根拠の確認の tier', () => {
    it('GET grounding-tier で今の tier を返す', async () => {
      settingsService.getGroundingTier.mockResolvedValue({ tier: 'CLASSIC' });
      await expect(controller.getGroundingTier()).resolves.toEqual({
        tier: 'CLASSIC',
      });
    });

    it('POST grounding-tier/standard で Standard に切り替える', async () => {
      const switched = {
        tier: 'STANDARD',
        version: '4',
        settings: sampleSettings,
      };
      settingsService.switchGroundingToStandard.mockResolvedValue(
        switched as any,
      );
      await expect(controller.switchGroundingToStandard()).resolves.toEqual(
        switched,
      );
    });
  });
});
