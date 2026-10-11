import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { GuardrailService } from '../privacy/guardrail.service';
import { KeychainSecretStore } from './secret-store';

/** 設定ファイルの内容 */
interface SettingsFile {
  dataDir?: string;
  /** キーチェーンを使えない環境だけ保存する（macOS では起動時にキーチェーンへ移し、ファイルから消す） */
  elevenlabsApiKey?: string;
  /** キーチェーンを使えない環境だけ保存する（macOS では起動時にキーチェーンへ移し、ファイルから消す） */
  anthropicApiKey?: string;
  enableDeepSearch?: boolean;
  enableContextAnalysis?: boolean;
  /** 個人情報チェックと Claude に送る前の確認に使う Amazon Bedrock Guardrails の ID */
  bedrockGuardrailId?: string;
  /**
   * 固定する Guardrail のバージョン（"1" などの番号。空の場合は DRAFT）
   * DRAFT はコンソールで編集するとすぐに変わり、どの設定で確認したかを後から確かめられないため、番号付きのバージョンを勧める。
   * 保存する前に、ApplyGuardrail を呼べることを確かめる（存在しないバージョンで Claude を使う機能が止まらないため）
   */
  bedrockGuardrailPinnedVersion?: string;
  /** 以前のバージョンで保存した値（確かめずに保存されたため、読み込まない） */
  bedrockGuardrailVersion?: string;
  /**
   * AWS の認証情報に使う ~/.aws のプロファイル名（空の場合は default）
   * Finder から起動したアプリにはシェルの AWS_PROFILE が渡らないため、設定画面で指定できるようにする
   */
  awsProfile?: string;
}

/** AWS のプロファイル名として受け付ける値（空は default） */
const AWS_PROFILE_PATTERN = /^[A-Za-z0-9_.+=,@-]*$/;

/** API キーの設定項目と、読み込む環境変数 */
const API_KEYS = [
  { field: 'elevenlabsApiKey', env: 'ELEVENLABS_API_KEY' },
  { field: 'anthropicApiKey', env: 'ANTHROPIC_API_KEY' },
] as const;

type ApiKeyField = (typeof API_KEYS)[number]['field'];

/** API キーの状態（画面には値そのものを返さない） */
export interface ApiKeyStatus {
  configured: boolean;
  /** 末尾4文字（どのキーを設定したか確かめるため。短いキーは空） */
  last4: string;
}

/** Guardrail のバージョンとして受け付ける値（空・DRAFT・番号） */
const GUARDRAIL_VERSION_PATTERN = /^(|DRAFT|[1-9][0-9]*)$/;

/** API レスポンス用の設定情報 */
export interface AppSettings {
  appVersion: string;
  storageType: string;
  paths: {
    dataDir: string;
    audioDir: string;
    transcriptionsDir: string;
    documentsDir: string;
    documentMetadataDir: string;
    summaryLogsDir: string;
  };
  apiKeys: Record<ApiKeyField, ApiKeyStatus>;
  /** API キーの保存先（macOS ではキーチェーン） */
  apiKeyStorage: 'keychain' | 'file';
  enableDeepSearch: boolean;
  enableContextAnalysis: boolean;
  guardrail: {
    id: string;
    /** 設定したバージョン（空の場合は DRAFT を使う） */
    version: string;
  };
  /** AWS の認証情報に使う ~/.aws のプロファイル名（空の場合は default） */
  awsProfile: string;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly settingsFilePath: string;
  /** 設定の更新を1つずつ順番に行うための待ち行列（AWS_PROFILE の切り替えと確認が重ならないように） */
  private updating: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly configService: ConfigService,
    private readonly guardrail: GuardrailService,
  ) {
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
      paths: {
        dataDir,
        audioDir: path.resolve(
          this.configService.get<string>('AUDIO_DIR') ||
            path.join(dataDir, 'audio'),
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
        summaryLogsDir: path.resolve(path.join(dataDir, 'summary-logs')),
      },
      apiKeys: {
        elevenlabsApiKey: toApiKeyStatus(
          this.configService.get<string>('ELEVENLABS_API_KEY'),
        ),
        anthropicApiKey: toApiKeyStatus(
          this.configService.get<string>('ANTHROPIC_API_KEY'),
        ),
      },
      apiKeyStorage: KeychainSecretStore.isAvailable() ? 'keychain' : 'file',
      enableDeepSearch: this.readSettingsFile().enableDeepSearch ?? false,
      enableContextAnalysis:
        this.readSettingsFile().enableContextAnalysis ?? false,
      guardrail: {
        id: this.configService.get<string>('BEDROCK_GUARDRAIL_ID') || '',
        version: (
          this.configService.get<string>('BEDROCK_GUARDRAIL_VERSION') ?? ''
        ).trim(),
      },
      awsProfile: process.env.AWS_PROFILE ?? '',
    };
  }

  /**
   * 設定を更新して settings.json に保存
   * API キーは、macOS ではキーチェーンに保存し、settings.json には書かない。空文字を渡すと削除する
   */
  async updateSettings(
    dto: Parameters<SettingsService['applyUpdate']>[0],
  ): ReturnType<SettingsService['applyUpdate']> {
    // 同時に保存されても、プロファイルの切り替え・確認・保存（失敗時の巻き戻し）が混ざらないよう、順番に行う
    const run = this.updating.then(() => this.applyUpdate(dto));
    this.updating = run.catch(() => undefined);
    return run;
  }

  private async applyUpdate(dto: {
    dataDir?: string;
    elevenlabsApiKey?: string;
    anthropicApiKey?: string;
    enableDeepSearch?: boolean;
    enableContextAnalysis?: boolean;
    bedrockGuardrailId?: string;
    bedrockGuardrailVersion?: string;
    awsProfile?: string;
  }): Promise<{
    settings: AppSettings;
    restartRequired: boolean;
  }> {
    const rawVersion = dto.bedrockGuardrailVersion?.trim();
    if (
      rawVersion !== undefined &&
      !GUARDRAIL_VERSION_PATTERN.test(rawVersion)
    ) {
      throw new BadRequestException(
        'Guardrail のバージョンは、番号（1 など）か DRAFT を指定してください',
      );
    }
    // DRAFT と空は同じ（DRAFT を使う）
    const guardrailVersion = rawVersion === 'DRAFT' ? '' : rawVersion;
    const awsProfile = dto.awsProfile?.trim();
    if (awsProfile !== undefined && !AWS_PROFILE_PATTERN.test(awsProfile)) {
      throw new BadRequestException(
        'AWS のプロファイル名に使えない文字が含まれています',
      );
    }
    const previousProfile = process.env.AWS_PROFILE;
    if (awsProfile !== undefined && awsProfile !== (previousProfile ?? '')) {
      // 新しいプロファイルで確かめるため、先に切り替える（確かめられなければ元に戻す）
      setAwsProfile(awsProfile);
      this.guardrail.resetClient();
      try {
        await this.verifyGuardrail(
          dto.bedrockGuardrailId ?? this.guardrail.guardrailId,
          guardrailVersion ?? this.guardrail.guardrailVersion,
          true,
        );
      } catch (error) {
        setAwsProfile(previousProfile ?? '');
        this.guardrail.resetClient();
        throw error;
      }
    } else {
      await this.verifyGuardrail(dto.bedrockGuardrailId, guardrailVersion);
    }

    const current = this.readSettingsFile();
    const updated: SettingsFile = { ...current };

    if (dto.dataDir !== undefined) {
      updated.dataDir = dto.dataDir;
    }
    const restartRequired = false;
    let apiKeyChanged = false;

    const keychain = KeychainSecretStore.isAvailable()
      ? new KeychainSecretStore()
      : null;
    for (const { field, env } of API_KEYS) {
      const value = dto[field]?.trim();
      if (value === undefined) continue;
      if (keychain) {
        try {
          if (value) keychain.set(field, value);
          else keychain.delete(field);
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : String(error),
          );
        }
        delete updated[field];
      } else {
        updated[field] = value;
      }
      process.env[env] = value;
      apiKeyChanged = true;
    }
    if (dto.enableDeepSearch !== undefined) {
      updated.enableDeepSearch = dto.enableDeepSearch;
    }
    if (dto.enableContextAnalysis !== undefined) {
      updated.enableContextAnalysis = dto.enableContextAnalysis;
    }
    if (dto.bedrockGuardrailId !== undefined) {
      updated.bedrockGuardrailId = dto.bedrockGuardrailId.trim();
      process.env.BEDROCK_GUARDRAIL_ID = updated.bedrockGuardrailId;
    }
    if (guardrailVersion !== undefined) {
      // DRAFT は空で保存し、環境変数の値より設定画面の値を優先する
      updated.bedrockGuardrailPinnedVersion = guardrailVersion;
      process.env.BEDROCK_GUARDRAIL_VERSION = guardrailVersion;
    }
    if (awsProfile !== undefined) {
      updated.awsProfile = awsProfile;
    }

    this.writeSettingsFile(updated);
    this.logger.log(`設定を保存しました: ${this.settingsFilePath}`);

    if (apiKeyChanged) {
      this.logger.log('APIキーを即時反映しました（再起動不要）');
    }

    return {
      settings: this.getSettings(),
      restartRequired,
    };
  }

  /**
   * 番号付きのバージョンを使う設定にする場合、保存する前に ApplyGuardrail を呼べることを確かめる
   * （ID かバージョンを変えたときだけ。DRAFT と、ID が空の場合は確かめない）
   */
  private async verifyGuardrail(
    idInput: string | undefined,
    versionInput: string | undefined,
    /** AWS のプロファイルを変えたとき（DRAFT でも呼べることを確かめる） */
    profileChanged = false,
  ): Promise<void> {
    if (idInput === undefined && versionInput === undefined) return;
    const id = idInput?.trim() ?? this.guardrail.guardrailId;
    const version =
      versionInput ??
      (
        this.configService.get<string>('BEDROCK_GUARDRAIL_VERSION') ?? ''
      ).trim();
    if (!id) return;
    if (profileChanged) {
      try {
        await this.guardrail.verify(id, version || 'DRAFT');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadRequestException(
          `AWS のプロファイル（${process.env.AWS_PROFILE || 'default'}）で Guardrail（ID: ${id}）を呼べなかったため、保存しませんでした。~/.aws の設定を確認してください（${message}）`,
        );
      }
      return;
    }
    // ID を変えた場合は、バージョンが空（DRAFT）でも、存在する ID かを確かめる
    const idChanged =
      idInput !== undefined && idInput.trim() !== this.guardrail.guardrailId;
    if (!version && !idChanged) return;
    const checkedVersion = version || 'DRAFT';
    try {
      await this.guardrail.verify(id, checkedVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Guardrail（ID: ${id}、バージョン: ${checkedVersion}）を確認できなかったため、保存しませんでした。ID とバージョンが存在するか、AWS の認証情報を確認してください（${message}）`,
      );
    }
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
      process.env.SETTINGS_FILE || path.join(process.cwd(), 'settings.json');

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

      // APIキーはアプリの設定画面の値（settings.json）を常に優先する
      for (const { field, env } of API_KEYS) {
        if (settings[field]) {
          process.env[env] = settings[field];
          console.log(`[Settings] ${env} を settings.json から読み込み`);
        }
      }
      if (settings.bedrockGuardrailId) {
        process.env.BEDROCK_GUARDRAIL_ID = settings.bedrockGuardrailId;
      }
      // 以前のバージョンで保存した bedrockGuardrailVersion は、確かめずに保存されたため読み込まない
      if (settings.bedrockGuardrailPinnedVersion !== undefined) {
        process.env.BEDROCK_GUARDRAIL_VERSION =
          settings.bedrockGuardrailPinnedVersion;
      }
      // 設定画面で指定したプロファイルを、シェルの AWS_PROFILE より優先する
      if (settings.awsProfile) {
        setAwsProfile(settings.awsProfile);
      }
    } catch (error) {
      console.warn(`[Settings] 設定ファイルの読み込みに失敗: ${error}`);
    }
  }

  /**
   * 起動時に、API キーをキーチェーンから process.env に読み込む（macOS のみ）
   * settings.json に API キーが残っている場合（以前のバージョンで保存したもの）は、
   * キーチェーンに移してから settings.json から消す。移せなかった場合は settings.json に残す
   * （main.ts で loadSettingsIntoEnv の後に呼び出す）
   */
  static loadApiKeysFromKeychain(
    keychain: KeychainSecretStore | null = KeychainSecretStore.isAvailable()
      ? new KeychainSecretStore()
      : null,
  ): void {
    if (!keychain) return;
    const settingsPath =
      process.env.SETTINGS_FILE || path.join(process.cwd(), 'settings.json');
    let settings: SettingsFile = {};
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(
          fs.readFileSync(settingsPath, 'utf-8'),
        ) as SettingsFile;
      }
    } catch (error) {
      console.warn(`[Settings] 設定ファイルの読み込みに失敗: ${error}`);
      return;
    }

    let migrated = false;
    for (const { field, env } of API_KEYS) {
      try {
        const legacy = settings[field];
        if (legacy) {
          keychain.set(field, legacy);
          delete settings[field];
          migrated = true;
          console.log(
            `[Settings] ${env} を settings.json からキーチェーンに移しました`,
          );
        }
        const value = keychain.get(field);
        if (value) process.env[env] = value;
      } catch (error) {
        console.warn(
          `[Settings] ${env} をキーチェーンで扱えませんでした: ${error}`,
        );
      }
    }
    if (migrated) {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2),
        'utf-8',
      );
    }
  }
}

/** API キーの値から、画面に返す状態を作る（値そのものは返さない） */
function toApiKeyStatus(value: string | undefined): ApiKeyStatus {
  const key = (value ?? '').trim();
  return {
    configured: key !== '',
    last4: key.length >= 12 ? key.slice(-4) : '',
  };
}

/** AWS の認証情報に使うプロファイルを切り替える（空の場合は default を使うよう、環境変数を消す） */
function setAwsProfile(profile: string): void {
  if (profile) process.env.AWS_PROFILE = profile;
  else delete process.env.AWS_PROFILE;
}
