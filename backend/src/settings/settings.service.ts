import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/** 設定ファイルの内容 */
interface SettingsFile {
  dataDir?: string;
  elevenlabsApiKey?: string;
  anthropicApiKey?: string;
  enableDeepSearch?: boolean;
  enableContextAnalysis?: boolean;
}

/** API レスポンス用の設定情報 */
export interface AppSettings {
  appVersion: string;
  storageType: string;
  port: number;
  paths: {
    dataDir: string;
    outputsDir: string;
    transcriptionsDir: string;
    documentsDir: string;
    documentMetadataDir: string;
  };
  apiKeys: {
    elevenlabsApiKey: string;
    anthropicApiKey: string;
  };
  enableDeepSearch: boolean;
  enableContextAnalysis: boolean;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly settingsFilePath: string;

  constructor(private readonly configService: ConfigService) {
    this.settingsFilePath =
      this.configService.get<string>('SETTINGS_FILE') ||
      path.join(process.cwd(), 'settings.json');
    this.logger.log(`設定ファイル: ${this.settingsFilePath}`);
  }

  /** 現在の設定を取得 */
  getSettings(): AppSettings {
    const dataDir = path.resolve(
      this.configService.get<string>('DATA_DIR') || './data',
    );

    return {
      appVersion: '0.1.0',
      storageType: this.configService.get<string>('STORAGE_TYPE', 'local'),
      port: Number(this.configService.get('BACKEND_PORT', '3100')),
      paths: {
        dataDir,
        outputsDir: path.resolve(
          this.configService.get<string>('OUTPUTS_DIR') ||
            path.join(dataDir, 'outputs'),
        ),
        transcriptionsDir: path.resolve(
          this.configService.get<string>('TRANSCRIPTIONS_DIR') ||
            path.join(dataDir, 'transcriptions'),
        ),
        documentsDir: path.resolve(
          this.configService.get<string>('DOCUMENTS_DIR') ||
            path.join(dataDir, 'documents'),
        ),
        documentMetadataDir: path.resolve(
          this.configService.get<string>('DOCUMENT_METADATA_DIR') ||
            path.join(dataDir, 'document-metadata'),
        ),
      },
      apiKeys: {
        elevenlabsApiKey:
          this.configService.get<string>('ELEVENLABS_API_KEY') || '',
        anthropicApiKey:
          this.configService.get<string>('ANTHROPIC_API_KEY') || '',
      },
      enableDeepSearch: this.readSettingsFile().enableDeepSearch ?? false,
      enableContextAnalysis: this.readSettingsFile().enableContextAnalysis ?? false,
    };
  }

  /** 設定を更新して settings.json に保存 */
  updateSettings(dto: {
    dataDir?: string;
    elevenlabsApiKey?: string;
    anthropicApiKey?: string;
    enableDeepSearch?: boolean;
    enableContextAnalysis?: boolean;
  }): {
    settings: AppSettings;
    restartRequired: boolean;
  } {
    const current = this.readSettingsFile();
    const updated: SettingsFile = { ...current };

    if (dto.dataDir !== undefined) {
      updated.dataDir = dto.dataDir;
    }
    let apiKeyChanged = false;

    if (dto.elevenlabsApiKey !== undefined) {
      updated.elevenlabsApiKey = dto.elevenlabsApiKey;
      process.env.ELEVENLABS_API_KEY = dto.elevenlabsApiKey;
      apiKeyChanged = true;
    }
    if (dto.anthropicApiKey !== undefined) {
      updated.anthropicApiKey = dto.anthropicApiKey;
      process.env.ANTHROPIC_API_KEY = dto.anthropicApiKey;
      apiKeyChanged = true;
    }
    if (dto.enableDeepSearch !== undefined) {
      updated.enableDeepSearch = dto.enableDeepSearch;
    }
    if (dto.enableContextAnalysis !== undefined) {
      updated.enableContextAnalysis = dto.enableContextAnalysis;
    }

    this.writeSettingsFile(updated);
    this.logger.log(`設定を保存しました: ${this.settingsFilePath}`);

    if (apiKeyChanged) {
      this.logger.log('APIキーを即時反映しました（再起動不要）');
    }

    return {
      settings: this.getSettings(),
      restartRequired: false,
    };
  }

  /** settings.json を読み込み（存在しない場合は空オブジェクト） */
  private readSettingsFile(): SettingsFile {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const content = fs.readFileSync(this.settingsFilePath, 'utf-8');
        return JSON.parse(content) as SettingsFile;
      }
    } catch (error) {
      this.logger.warn(`設定ファイルの読み込みに失敗: ${error}`);
    }
    return {};
  }

  /** settings.json に書き込み */
  private writeSettingsFile(settings: SettingsFile): void {
    const dir = path.dirname(this.settingsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.settingsFilePath,
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  }

  /**
   * 起動時に settings.json の値を process.env にマージする
   * （main.ts の bootstrap 前に呼び出す静的メソッド）
   */
  static loadSettingsIntoEnv(): void {
    const settingsPath =
      process.env.SETTINGS_FILE ||
      path.join(process.cwd(), 'settings.json');

    try {
      if (!fs.existsSync(settingsPath)) return;

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as SettingsFile;

      // settings.json の dataDir が設定されていて、環境変数に未設定なら適用
      if (settings.dataDir && !process.env.DATA_DIR) {
        process.env.DATA_DIR = settings.dataDir;
        console.log(
          `[Settings] DATA_DIR を settings.json から読み込み: ${settings.dataDir}`,
        );
      }

      // APIキーをsettings.jsonから環境変数にマージ
      if (settings.elevenlabsApiKey && !process.env.ELEVENLABS_API_KEY) {
        process.env.ELEVENLABS_API_KEY = settings.elevenlabsApiKey;
        console.log('[Settings] ELEVENLABS_API_KEY を settings.json から読み込み');
      }
      if (settings.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = settings.anthropicApiKey;
        console.log('[Settings] ANTHROPIC_API_KEY を settings.json から読み込み');
      }
    } catch (error) {
      console.warn(`[Settings] 設定ファイルの読み込みに失敗: ${error}`);
    }
  }
}
