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
  let guardrail: {
    guardrailId: string;
    guardrailVersion: string;
    verify: jest.Mock;
    resetClient: jest.Mock;
  };
  const originalAwsProfile = process.env.AWS_PROFILE;

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
      guardrailVersion: 'DRAFT',
      verify: jest.fn().mockResolvedValue(undefined),
      resetClient: jest.fn(),
    };
    delete process.env.AWS_PROFILE;

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
    // AI 分析の ON/OFF を保存していない状態から始める
    delete process.env.AI_ANALYSIS;
  });

  afterEach(() => {
    process.env.AI_ANALYSIS = 'on';
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.BEDROCK_GUARDRAIL_ID;
    delete process.env.BEDROCK_GUARDRAIL_VERSION;
    if (originalAwsProfile === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = originalAwsProfile;
  });

  describe('getSettings', () => {
    it('初期状態で正しいデフォルト値を返す', () => {
      const settings = service.getSettings();

      expect(settings.enableAiAnalysis).toBe(false);
      expect(settings.enableGinzaKeywords).toBe(false);
      expect(settings.paths.dataDir).toBeTruthy();
      expect(settings.paths.audioDir).toContain('audio');
      expect(settings.paths.transcriptionsDir).toContain('transcriptions');
      expect(settings.guardrail).toEqual({ id: '', version: '' });
    });

    it('settings.jsonが存在する場合はその値を反映する', () => {
      writeSettings({ enableGinzaKeywords: true });

      const settings = service.getSettings();

      expect(settings.enableGinzaKeywords).toBe(true);
    });

    it('AI 分析の ON/OFF を保存していない場合は、API キーと Guardrail ID の両方があれば ON にする', () => {
      process.env.ANTHROPIC_API_KEY = 'test-value-abcdefgh-1234';
      expect(service.getSettings().enableAiAnalysis).toBe(false);

      process.env.BEDROCK_GUARDRAIL_ID = 'gr-1';
      expect(service.getSettings().enableAiAnalysis).toBe(true);
    });

    it('settings.jsonが壊れていてもクラッシュせずデフォルト値を返す', () => {
      fs.writeFileSync(settingsFilePath, 'invalid json', 'utf-8');

      const settings = service.getSettings();

      expect(settings.enableGinzaKeywords).toBe(false);
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

    it('AI 分析を ON/OFF でき、すぐに反映される（API キーと Guardrail ID があっても OFF にできる）', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-value-abcdefgh-1234';
      process.env.BEDROCK_GUARDRAIL_ID = 'gr-1';

      const off = await service.updateSettings({ enableAiAnalysis: false });
      expect(off.settings.enableAiAnalysis).toBe(false);
      expect(process.env.AI_ANALYSIS).toBe('off');

      const on = await service.updateSettings({ enableAiAnalysis: true });
      expect(on.settings.enableAiAnalysis).toBe(true);
      expect(process.env.AI_ANALYSIS).toBe('on');
    });

    it('キーチェーンを使えない環境では、更新内容がsettings.jsonに永続化される', async () => {
      await service.updateSettings({
        enableAiAnalysis: true,
        elevenlabsApiKey: 'saved-key',
      });

      const raw = readSettings();
      expect(raw.enableAiAnalysis).toBe(true);
      expect(raw.elevenlabsApiKey).toBe('saved-key');
    });

    it('既存の設定値を上書きせずに部分更新できる', async () => {
      writeSettings({ enableGinzaKeywords: true, enableAiAnalysis: false });

      await service.updateSettings({ enableAiAnalysis: true });

      const raw = readSettings();
      expect(raw.enableGinzaKeywords).toBe(true);
      expect(raw.enableAiAnalysis).toBe(true);
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

    describe('AWS のプロファイル', () => {
      it('プロファイルを変えたら、クライアントを作り直し、そのプロファイルで Guardrail を呼べることを確かめて保存する', async () => {
        guardrail.guardrailId = 'gr-1';

        await service.updateSettings({ awsProfile: 'kiro' });

        expect(guardrail.resetClient).toHaveBeenCalled();
        expect(guardrail.verify).toHaveBeenCalledWith('gr-1', 'DRAFT');
        expect(process.env.AWS_PROFILE).toBe('kiro');
        expect(readSettings().awsProfile).toBe('kiro');
        expect(service.getSettings().awsProfile).toBe('kiro');
      });

      it('呼べなかった場合は保存せず、元のプロファイルに戻す', async () => {
        guardrail.guardrailId = 'gr-1';
        process.env.AWS_PROFILE = 'old';
        guardrail.verify.mockRejectedValue(new Error('invalid token'));

        await expect(
          service.updateSettings({ awsProfile: 'kiro' }),
        ).rejects.toThrow('AWS のプロファイル（kiro）で Guardrail');
        expect(process.env.AWS_PROFILE).toBe('old');
        expect(fs.existsSync(settingsFilePath)).toBe(false);
      });

      it('空にすると default を使う（環境変数を消す）', async () => {
        process.env.AWS_PROFILE = 'kiro';

        await service.updateSettings({ awsProfile: '' });

        expect(process.env.AWS_PROFILE).toBeUndefined();
        expect(readSettings().awsProfile).toBe('');
      });

      it('同時に保存しても、失敗した側の巻き戻しが、もう一方のプロファイルを上書きしない', async () => {
        guardrail.guardrailId = 'gr-1';
        process.env.AWS_PROFILE = 'old';
        guardrail.verify.mockImplementation(async () => {
          await new Promise((resolve) => setImmediate(resolve));
          if (process.env.AWS_PROFILE === 'bad')
            throw new Error('invalid token');
        });

        const results = await Promise.allSettled([
          service.updateSettings({ awsProfile: 'bad' }),
          service.updateSettings({ awsProfile: 'good' }),
        ]);

        expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
        expect(process.env.AWS_PROFILE).toBe('good');
        expect(readSettings().awsProfile).toBe('good');
      });

      it('プロファイル名に使えない文字は受け付けない', async () => {
        await expect(
          service.updateSettings({ awsProfile: 'a b' }),
        ).rejects.toThrow('使えない文字');
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

      it('ID を変えた場合は、バージョンが空でも DRAFT で確かめる', async () => {
        guardrail.guardrailId = 'gr-old';

        await service.updateSettings({ bedrockGuardrailId: 'gr-new' });

        expect(guardrail.verify).toHaveBeenCalledWith('gr-new', 'DRAFT');
        expect(readSettings().bedrockGuardrailId).toBe('gr-new');
      });

      it('存在しない ID は、バージョンが空でも保存しない', async () => {
        guardrail.verify.mockRejectedValue(new Error('ResourceNotFound'));

        await expect(
          service.updateSettings({ bedrockGuardrailId: 'gr-missing' }),
        ).rejects.toThrow('保存しませんでした');
        expect(fs.existsSync(settingsFilePath)).toBe(false);
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

    it('設定画面で指定した AWS のプロファイルを、シェルの AWS_PROFILE より優先して読み込む', () => {
      const tempSettings = path.join(tmpDir, 'profile-settings.json');
      fs.writeFileSync(
        tempSettings,
        JSON.stringify({ awsProfile: 'kiro' }),
        'utf-8',
      );
      process.env.SETTINGS_FILE = tempSettings;
      process.env.AWS_PROFILE = 'shell';

      SettingsService.loadSettingsIntoEnv();

      expect(process.env.AWS_PROFILE).toBe('kiro');
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
