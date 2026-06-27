import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let tmpDir: string;
  let settingsFilePath: string;

  /** 一時ディレクトリに設定ファイルを書き込むヘルパー */
  function writeSettings(content: object) {
    fs.writeFileSync(settingsFilePath, JSON.stringify(content), 'utf-8');
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
    settingsFilePath = path.join(tmpDir, 'settings.json');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) => {
              const map: Record<string, string> = {
                SETTINGS_FILE: settingsFilePath,
                DATA_DIR: path.join(tmpDir, 'data'),
                STORAGE_TYPE: 'local',
              };
              return map[key] ?? defaultValue ?? '';
            },
          },
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    process.env.ELEVENLABS_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('getSettings', () => {
    it('初期状態で正しいデフォルト値を返す', () => {
      const settings = service.getSettings();

      expect(settings.storageType).toBe('local');
      expect(settings.enableDeepSearch).toBe(false);
      expect(settings.enableContextAnalysis).toBe(false);
      expect(settings.paths.dataDir).toBeTruthy();
      expect(settings.paths.audioDir).toContain('audio');
      expect(settings.paths.transcriptionsDir).toContain('transcriptions');
    });

    it('settings.jsonが存在する場合はその値を反映する', () => {
      writeSettings({ enableDeepSearch: true, enableContextAnalysis: true });

      const settings = service.getSettings();

      expect(settings.enableDeepSearch).toBe(true);
      expect(settings.enableContextAnalysis).toBe(true);
    });

    it('settings.jsonが壊れていてもクラッシュせずデフォルト値を返す', () => {
      fs.writeFileSync(settingsFilePath, 'invalid json', 'utf-8');

      const settings = service.getSettings();

      expect(settings.enableDeepSearch).toBe(false);
    });
  });

  describe('updateSettings', () => {
    it('elevenlabsApiKeyを更新するとprocess.envに即時反映される', () => {
      const result = service.updateSettings({ elevenlabsApiKey: 'new-key-123' });

      expect(result.restartRequired).toBe(false);
      expect(process.env.ELEVENLABS_API_KEY).toBe('new-key-123');
    });

    it('anthropicApiKeyを更新するとprocess.envに即時反映される', () => {
      service.updateSettings({ anthropicApiKey: 'anthropic-key-456' });

      expect(process.env.ANTHROPIC_API_KEY).toBe('anthropic-key-456');
    });

    it('enableDeepSearchをtrueに更新できる', () => {
      const result = service.updateSettings({ enableDeepSearch: true });

      expect(result.settings.enableDeepSearch).toBe(true);
    });

    it('enableContextAnalysisをtrueに更新できる', () => {
      const result = service.updateSettings({ enableContextAnalysis: true });

      expect(result.settings.enableContextAnalysis).toBe(true);
    });

    it('更新内容がsettings.jsonに永続化される', () => {
      service.updateSettings({ enableDeepSearch: true, elevenlabsApiKey: 'saved-key' });

      const raw = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8')) as {
        enableDeepSearch: boolean;
        elevenlabsApiKey: string;
      };
      expect(raw.enableDeepSearch).toBe(true);
      expect(raw.elevenlabsApiKey).toBe('saved-key');
    });

    it('既存の設定値を上書きせずに部分更新できる', () => {
      writeSettings({ enableDeepSearch: true, enableContextAnalysis: false });

      service.updateSettings({ enableContextAnalysis: true });

      const raw = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8')) as {
        enableDeepSearch: boolean;
        enableContextAnalysis: boolean;
      };
      expect(raw.enableDeepSearch).toBe(true);
      expect(raw.enableContextAnalysis).toBe(true);
    });
  });

  describe('loadSettingsIntoEnv（静的メソッド）', () => {
    it('settings.jsonのAPIキーをprocess.envに読み込む', () => {
      const tempSettings = path.join(tmpDir, 'static-settings.json');
      fs.writeFileSync(
        tempSettings,
        JSON.stringify({
          elevenlabsApiKey: 'static-el-key',
          anthropicApiKey: 'static-ant-key',
        }),
        'utf-8',
      );
      process.env.SETTINGS_FILE = tempSettings;

      SettingsService.loadSettingsIntoEnv();

      expect(process.env.ELEVENLABS_API_KEY).toBe('static-el-key');
      expect(process.env.ANTHROPIC_API_KEY).toBe('static-ant-key');

      delete process.env.SETTINGS_FILE;
    });

    it('settings.jsonが存在しない場合はクラッシュしない', () => {
      process.env.SETTINGS_FILE = path.join(tmpDir, 'nonexistent.json');

      expect(() => SettingsService.loadSettingsIntoEnv()).not.toThrow();

      delete process.env.SETTINGS_FILE;
    });

    it('settings.jsonが壊れていてもクラッシュしない', () => {
      const tempSettings = path.join(tmpDir, 'broken-settings.json');
      fs.writeFileSync(tempSettings, 'not-json', 'utf-8');
      process.env.SETTINGS_FILE = tempSettings;

      expect(() => SettingsService.loadSettingsIntoEnv()).not.toThrow();

      delete process.env.SETTINGS_FILE;
    });
  });
});
