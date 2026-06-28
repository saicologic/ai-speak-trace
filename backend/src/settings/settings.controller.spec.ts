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
  enableDeepSearch: false,
  enableContextAnalysis: true,
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
      const updated = { ...sampleSettings, enableDeepSearch: true };
      settingsService.updateSettings.mockReturnValue(updated as any);

      const result = controller.updateSettings({ enableDeepSearch: true });

      expect(settingsService.updateSettings).toHaveBeenCalledWith({ enableDeepSearch: true });
      expect(result).toEqual(updated);
    });

    it('一部のフィールドのみ更新できる', () => {
      settingsService.updateSettings.mockReturnValue(sampleSettings as any);

      controller.updateSettings({ elevenlabsApiKey: 'new-key' });

      expect(settingsService.updateSettings).toHaveBeenCalledWith({ elevenlabsApiKey: 'new-key' });
    });
  });
});
