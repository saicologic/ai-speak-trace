import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from './settings.service';
import { GuardrailService } from '../privacy/guardrail.service';
import { KeychainSecretStore } from './secret-store';

/** キーチェーンの代わりに使う、メモリ上のストア */
class FakeKeychain {
  values = new Map<string, string>();
  failOnSet = false;
  get(name: string): string | null {
    return this.values.get(name) ?? null;
  }
  set(name: string, value: string): void {
    if (this.failOnSet) throw new Error('保存できません');
    this.values.set(name, value);
  }
  delete(name: string): void {
    this.values.delete(name);
  }
}

describe('SettingsService', () => {
  let service: SettingsService;
  let tmpDir: string;
  let settingsFilePath: string;
  let guardrail: { guardrailId: string; verify: jest.Mock };

  /** 一時ディレクトリに設定ファイルを書き込むヘルパー */
  function writeSettings(content: object) {
    fs.writeFileSync(settingsFilePath, JSON.stringify(content), 'utf-8');
  }

  function readSettings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8')) as Record<
      string,
      unknown
    >;
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
    settingsFilePath = path.join(tmpDir, 'settings.json');
    guardrail = {
      guardrailId: '',
      verify: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: GuardrailService, useValue: guardrail },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) => {
              const map: Record<string, string | undefined> = {
                SETTINGS_FILE: settingsFilePath,
                DATA_DIR: path.join(tmpDir, 'data'),
                STORAGE_TYPE: 'local',
                ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                BEDROCK_GUARDRAIL_ID: process.env.BEDROCK_GUARDRAIL_ID,
                BEDROCK_GUARDRAIL_VERSION:
                  process.env.BEDROCK_GUARDRAIL_VERSION,
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
    delete process.env.BEDROCK_GUARDRAIL_ID;
    delete process.env.BEDROCK_GUARDRAIL_VERSION;
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
      expect(settings.guardrail).toEqual({ id: '', version: '' });
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

    it('API キーの値そのものは返さず、設定済みかと末尾4文字だけを返す', () => {
      process.env.ANTHROPIC_API_KEY = 'test-value-abcdefgh-1234';

      const settings = service.getSettings();

      expect(settings.apiKeys.anthropicApiKey).toEqual({
        configured: true,
        last4: '1234',
      });
      expect(settings.apiKeys.elevenlabsApiKey).toEqual({
        configured: false,
        last4: '',
      });
      expect(JSON.stringify(settings)).not.toContain('abcdefgh');
    });

    it('テストではキーチェーンを使わない（SECRET_STORE=file）', () => {
      expect(service.getSettings().apiKeyStorage).toBe('file');
    });
  });

  describe('updateSettings', () => {
    it('elevenlabsApiKeyを更新するとprocess.envに即時反映される', async () => {
      const result = await service.updateSettings({
        elevenlabsApiKey: 'new-key-123',
      });

      expect(result.restartRequired).toBe(false);
      expect(process.env.ELEVENLABS_API_KEY).toBe('new-key-123');
    });

    it('anthropicApiKeyを更新するとprocess.envに即時反映される', async () => {
      await service.updateSettings({ anthropicApiKey: 'anthropic-key-456' });

      expect(process.env.ANTHROPIC_API_KEY).toBe('anthropic-key-456');
    });

    it('enableDeepSearchをtrueに更新できる', async () => {
      const result = await service.updateSettings({ enableDeepSearch: true });

      expect(result.settings.enableDeepSearch).toBe(true);
    });

    it('enableContextAnalysisをtrueに更新できる', async () => {
      const result = await service.updateSettings({
        enableContextAnalysis: true,
      });

      expect(result.settings.enableContextAnalysis).toBe(true);
    });

    it('キーチェーンを使えない環境では、更新内容がsettings.jsonに永続化される', async () => {
      await service.updateSettings({
        enableDeepSearch: true,
        elevenlabsApiKey: 'saved-key',
      });

      const raw = readSettings();
      expect(raw.enableDeepSearch).toBe(true);
      expect(raw.elevenlabsApiKey).toBe('saved-key');
    });

    it('既存の設定値を上書きせずに部分更新できる', async () => {
      writeSettings({ enableDeepSearch: true, enableContextAnalysis: false });

      await service.updateSettings({ enableContextAnalysis: true });

      const raw = readSettings();
      expect(raw.enableDeepSearch).toBe(true);
      expect(raw.enableContextAnalysis).toBe(true);
    });

    describe('キーチェーンを使える環境', () => {
      let keychain: FakeKeychain;

      beforeEach(() => {
        keychain = new FakeKeychain();
        jest.spyOn(KeychainSecretStore, 'isAvailable').mockReturnValue(true);
        jest
          .spyOn(KeychainSecretStore.prototype, 'set')
          .mockImplementation((name, value) => keychain.set(name, value));
        jest
          .spyOn(KeychainSecretStore.prototype, 'delete')
          .mockImplementation((name) => keychain.delete(name));
      });

      afterEach(() => jest.restoreAllMocks());

      it('API キーをキーチェーンに保存し、settings.json には書かない', async () => {
        writeSettings({ anthropicApiKey: 'old-plain-value' });

        const result = await service.updateSettings({
          anthropicApiKey: 'keychain-value-xyz',
        });

        expect(keychain.get('anthropicApiKey')).toBe('keychain-value-xyz');
        expect(readSettings().anthropicApiKey).toBeUndefined();
        expect(process.env.ANTHROPIC_API_KEY).toBe('keychain-value-xyz');
        expect(result.settings.apiKeyStorage).toBe('keychain');
      });

      it('空文字を保存すると、キーチェーンから削除する', async () => {
        keychain.set('elevenlabsApiKey', 'to-be-removed');

        await service.updateSettings({ elevenlabsApiKey: '' });

        expect(keychain.get('elevenlabsApiKey')).toBeNull();
        expect(process.env.ELEVENLABS_API_KEY).toBe('');
      });

      it('キーチェーンに保存できない場合はエラーにし、設定を変えない', async () => {
        keychain.failOnSet = true;

        await expect(
          service.updateSettings({ anthropicApiKey: 'value' }),
        ).rejects.toThrow(BadRequestException);
        expect(process.env.ANTHROPIC_API_KEY).toBe('');
      });
    });

    describe('Guardrail のバージョン', () => {
      it('番号を保存する前に、ID とバージョンで呼べることを確かめる', async () => {
        await service.updateSettings({
          bedrockGuardrailId: 'gr-1',
          bedrockGuardrailVersion: '3',
        });

        expect(guardrail.verify).toHaveBeenCalledWith('gr-1', '3');
        expect(readSettings().bedrockGuardrailPinnedVersion).toBe('3');
        expect(process.env.BEDROCK_GUARDRAIL_VERSION).toBe('3');
      });

      it('確かめられなかった場合は保存しない', async () => {
        guardrail.verify.mockRejectedValue(new Error('ResourceNotFound'));

        await expect(
          service.updateSettings({
            bedrockGuardrailId: 'gr-1',
            bedrockGuardrailVersion: '99',
          }),
        ).rejects.toThrow('保存しませんでした');
        expect(fs.existsSync(settingsFilePath)).toBe(false);
        expect(process.env.BEDROCK_GUARDRAIL_VERSION).toBeUndefined();
      });

      it('ID だけを変えた場合も、固定したバージョンで確かめる', async () => {
        process.env.BEDROCK_GUARDRAIL_VERSION = '2';

        await service.updateSettings({ bedrockGuardrailId: 'gr-new' });

        expect(guardrail.verify).toHaveBeenCalledWith('gr-new', '2');
      });

      it('DRAFT は空として保存し、確かめない', async () => {
        guardrail.guardrailId = 'gr-1';

        await service.updateSettings({ bedrockGuardrailVersion: 'DRAFT' });

        expect(guardrail.verify).not.toHaveBeenCalled();
        expect(readSettings().bedrockGuardrailPinnedVersion).toBe('');
        expect(process.env.BEDROCK_GUARDRAIL_VERSION).toBe('');
      });

      it('番号と DRAFT 以外は受け付けない', async () => {
        await expect(
          service.updateSettings({ bedrockGuardrailVersion: 'v1' }),
        ).rejects.toThrow('番号（1 など）か DRAFT');
        expect(guardrail.verify).not.toHaveBeenCalled();
      });
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

    it('Guardrail ID と固定したバージョンは読み込み、以前の形式で保存したバージョンは読み込まない', () => {
      const tempSettings = path.join(tmpDir, 'guardrail-settings.json');
      fs.writeFileSync(
        tempSettings,
        JSON.stringify({
          bedrockGuardrailId: 'gr-test',
          bedrockGuardrailVersion: '1',
        }),
        'utf-8',
      );
      process.env.SETTINGS_FILE = tempSettings;
      delete process.env.BEDROCK_GUARDRAIL_ID;
      delete process.env.BEDROCK_GUARDRAIL_VERSION;

      SettingsService.loadSettingsIntoEnv();

      expect(process.env.BEDROCK_GUARDRAIL_ID).toBe('gr-test');
      expect(process.env.BEDROCK_GUARDRAIL_VERSION).toBeUndefined();

      fs.writeFileSync(
        tempSettings,
        JSON.stringify({
          bedrockGuardrailId: 'gr-test',
          bedrockGuardrailPinnedVersion: '4',
        }),
        'utf-8',
      );
      SettingsService.loadSettingsIntoEnv();

      expect(process.env.BEDROCK_GUARDRAIL_VERSION).toBe('4');

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

  describe('loadApiKeysFromKeychain（静的メソッド）', () => {
    let keychain: FakeKeychain;
    let tempSettings: string;

    beforeEach(() => {
      keychain = new FakeKeychain();
      tempSettings = path.join(tmpDir, 'keychain-settings.json');
      process.env.SETTINGS_FILE = tempSettings;
    });

    afterEach(() => {
      delete process.env.SETTINGS_FILE;
    });

    const load = () =>
      SettingsService.loadApiKeysFromKeychain(
        keychain as unknown as KeychainSecretStore,
      );

    it('settings.json に残っている API キーをキーチェーンに移し、settings.json から消す', () => {
      fs.writeFileSync(
        tempSettings,
        JSON.stringify({ anthropicApiKey: 'legacy-value', dataDir: '/data' }),
        'utf-8',
      );

      load();

      expect(keychain.get('anthropicApiKey')).toBe('legacy-value');
      expect(process.env.ANTHROPIC_API_KEY).toBe('legacy-value');
      expect(JSON.parse(fs.readFileSync(tempSettings, 'utf-8'))).toEqual({
        dataDir: '/data',
      });
    });

    it('キーチェーンに保存した API キーを process.env に読み込む', () => {
      keychain.set('elevenlabsApiKey', 'from-keychain');

      load();

      expect(process.env.ELEVENLABS_API_KEY).toBe('from-keychain');
    });

    it('キーチェーンに移せなかった場合は、settings.json に残す', () => {
      keychain.failOnSet = true;
      fs.writeFileSync(
        tempSettings,
        JSON.stringify({ anthropicApiKey: 'legacy-value' }),
        'utf-8',
      );

      load();

      expect(JSON.parse(fs.readFileSync(tempSettings, 'utf-8'))).toEqual({
        anthropicApiKey: 'legacy-value',
      });
    });

    it('キーチェーンを使えない環境では何もしない', () => {
      expect(() => SettingsService.loadApiKeysFromKeychain(null)).not.toThrow();
    });
  });
});
