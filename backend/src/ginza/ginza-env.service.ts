import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** 使う uv のバージョンと、配布ファイルの SHA-256（GitHub のリリースに載っている値） */
const UV_VERSION = '0.9.21';
const UV_SHA256: Record<string, string> = {
  arm64: '473977236ef8ac5937c80de08a3599cb6ed6021d0e015e10f88076767877a153',
  x64: '26390da48bd55e21ab62451a80ad240ef6df10d4c48ec199cbb34c18b4288983',
};
const UV_TARGET: Record<string, string> = {
  arm64: 'aarch64-apple-darwin',
  x64: 'x86_64-apple-darwin',
};

/** GiNZA を動かす Python のバージョン */
const PYTHON_VERSION = '3.12';

/** 同梱するファイル（backend/python） */
const SCRIPT_FILE = 'ginza_keywords.py';
const REQUIREMENTS_FILE = 'requirements.txt';

/** インストールの各段階にかけてよい時間 */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

export type GinzaState =
  | 'unsupported'
  | 'not_installed'
  | 'installing'
  | 'ready'
  | 'error';

/** GiNZA の準備の状態 */
export interface GinzaStatus {
  state: GinzaState;
  /** 進み具合やエラーの説明 */
  message: string;
  /** 入っているパッケージのバージョン（ready のときだけ） */
  versions?: Record<string, string>;
}

/** インストールが終わったことの記録（installed.json） */
interface InstalledMarker {
  /** 入れたパッケージの一覧（requirements.txt）のハッシュ */
  requirementsHash: string;
  versions: Record<string, string>;
}

/**
 * GiNZA を動かす Python の環境を用意するサービス（キーワード抽出のベータ機能）
 * - DMG を大きくしないため、初めて使うときに uv で Python と GiNZA を入れる
 * - 入れる場所は settings.json と同じフォルダの ginza/（アプリでは Application Support）
 * - uv は SHA-256 を、Python のパッケージは requirements.txt のハッシュを確かめてから入れる
 */
@Injectable()
export class GinzaEnvService {
  private readonly logger = new Logger(GinzaEnvService.name);
  private readonly baseDir: string;
  private readonly bundleDir: string;
  private installing: Promise<void> | null = null;
  private lastError = '';
  private progress = '';

  constructor(private readonly configService: ConfigService) {
    const settingsFile =
      this.configService.get<string>('SETTINGS_FILE') ||
      path.join(process.cwd(), 'settings.json');
    this.baseDir =
      this.configService.get<string>('GINZA_HOME') ||
      path.join(path.dirname(path.resolve(settingsFile)), 'ginza');
    // dist/ginza から見た backend/python（pkg でバイナリにした場合は assets として同梱する）
    this.bundleDir =
      this.configService.get<string>('GINZA_BUNDLE_DIR') ||
      path.resolve(__dirname, '..', '..', 'python');
  }

  /** GiNZA を動かす Python のパス */
  get pythonPath(): string {
    return path.join(this.baseDir, 'venv', 'bin', 'python');
  }

  /**
   * GiNZA の Python に渡す環境変数（確認と解析で同じにする）
   * 親プロセスの PYTHONPATH・PYTHONHOME などを渡さず、入れた仮想環境のパッケージだけを使う
   */
  get pythonEnv(): NodeJS.ProcessEnv {
    return {
      HOME: process.env.HOME ?? '',
      PATH: '/usr/bin:/bin',
      PYTHONIOENCODING: 'utf-8',
    };
  }

  /** 実行するスクリプトのパス（同梱ファイルから写す） */
  get scriptPath(): string {
    return path.join(this.baseDir, SCRIPT_FILE);
  }

  private get markerPath(): string {
    return path.join(this.baseDir, 'installed.json');
  }

  /**
   * 同梱したパッケージの一覧のハッシュ（アプリの更新で変わったら入れ直す）
   * コメント行は除く（コメントだけの変更で、数百 MB を入れ直さないため）
   */
  private async requirementsHash(): Promise<string> {
    return createHash('sha256')
      .update(await this.readPackages())
      .digest('hex');
  }

  /**
   * 同梱したスクリプトとパッケージの一覧のハッシュ
   * アプリの更新でどちらかが変わったら、解析結果を作り直す（パッケージの一覧のコメント行は除く）
   */
  async engineHash(): Promise<string> {
    return createHash('sha256')
      .update(await this.readPackages())
      .update('\u0000')
      .update(await fs.readFile(path.join(this.bundleDir, SCRIPT_FILE)))
      .digest('hex');
  }

  /** 同梱したパッケージの一覧から、コメント行を除いたもの */
  private async readPackages(): Promise<string> {
    const text = await fs.readFile(
      path.join(this.bundleDir, REQUIREMENTS_FILE),
      'utf-8',
    );
    return text
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
  }

  /**
   * 同梱したスクリプトを、実行する場所に写す（アプリの更新でスクリプトだけ変わった場合も、入れ直さずに使う）
   * pkg のバイナリの中のファイルは Python から直接読めないため
   */
  async syncScript(): Promise<void> {
    const bundled = await fs.readFile(path.join(this.bundleDir, SCRIPT_FILE));
    const current = await fs.readFile(this.scriptPath).catch(() => null);
    if (current && bundled.equals(current)) return;
    await fs.writeFile(this.scriptPath, bundled);
  }

  /** 今の状態 */
  async getStatus(): Promise<GinzaStatus> {
    if (!isSupportedPlatform()) {
      return {
        state: 'unsupported',
        message: 'GiNZA のキーワード抽出は macOS でだけ使えます',
      };
    }
    if (this.installing) {
      return { state: 'installing', message: this.progress };
    }
    const marker = await this.readMarker();
    if (
      marker &&
      marker.requirementsHash === (await this.requirementsHash()) &&
      existsSync(this.pythonPath)
    ) {
      return { state: 'ready', message: '', versions: marker.versions };
    }
    if (this.lastError) {
      return { state: 'error', message: this.lastError };
    }
    return {
      state: 'not_installed',
      message: marker
        ? 'アプリの更新で GiNZA の入れ直しが必要です'
        : 'GiNZA が入っていません',
    };
  }

  /** インストールを始める（終わるのを待たない。すでに進めている場合は何もしない） */
  startInstall(): void {
    // 対応外の環境では、今ある環境を消したり、ダウンロードを始めたりしない
    if (!isSupportedPlatform()) return;
    if (this.installing) return;
    this.lastError = '';
    this.installing = this.install()
      .catch((error: unknown) => {
        this.lastError = `GiNZA を入れられませんでした: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(this.lastError);
      })
      .finally(() => {
        this.installing = null;
        this.progress = '';
      });
  }

  private async install(): Promise<void> {
    const arch = process.arch;
    await fs.mkdir(this.baseDir, { recursive: true });
    // 途中まで入った古い環境が残っていると確かめられないため、消してから入れる
    await fs.rm(this.markerPath, { force: true });
    await fs.rm(path.join(this.baseDir, 'venv'), {
      recursive: true,
      force: true,
    });

    this.progress = 'uv をダウンロードしています';
    const uv = await this.downloadUv(arch);

    const env = {
      HOME: process.env.HOME ?? '',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      UV_CACHE_DIR: path.join(this.baseDir, 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(this.baseDir, 'python'),
      UV_NO_CONFIG: '1',
    };
    const run = (args: string[]) =>
      execFileAsync(uv, args, {
        env,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });

    this.progress = `Python ${PYTHON_VERSION} を準備しています`;
    await run([
      'venv',
      path.join(this.baseDir, 'venv'),
      '--python',
      PYTHON_VERSION,
      '--python-preference',
      'only-managed',
    ]);

    // 同梱ファイルを写す（pkg のバイナリの中のファイルは Python から直接読めないため）
    await fs.writeFile(
      path.join(this.baseDir, REQUIREMENTS_FILE),
      await fs.readFile(path.join(this.bundleDir, REQUIREMENTS_FILE)),
    );
    await this.syncScript();

    this.progress = 'GiNZA をインストールしています（数分かかります）';
    await run([
      'pip',
      'install',
      '--python',
      this.pythonPath,
      '--require-hashes',
      '--only-binary',
      ':all:',
      '-r',
      path.join(this.baseDir, REQUIREMENTS_FILE),
    ]);

    this.progress = '動作を確かめています';
    // 本番の解析と同じ環境変数で確かめる（親の PYTHONPATH などで読み込むパッケージが変わらないように）
    const { stdout } = await execFileAsync(
      this.pythonPath,
      [this.scriptPath, '--check'],
      {
        env: this.pythonEnv,
        timeout: 2 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const checked = JSON.parse(stdout) as {
      ok?: boolean;
      versions?: Record<string, string>;
    };
    if (!checked.ok)
      throw new Error('GiNZA の読み込みを確かめられませんでした');

    const marker: InstalledMarker = {
      requirementsHash: await this.requirementsHash(),
      versions: checked.versions ?? {},
    };
    await fs.writeFile(this.markerPath, JSON.stringify(marker, null, 2));
    // ダウンロードしたファイルの置き場は使い終わったので消す（数百 MB になるため）
    await fs.rm(env.UV_CACHE_DIR, { recursive: true, force: true });
    this.logger.log(`GiNZA を入れました: ${JSON.stringify(marker.versions)}`);
  }

  /** uv をダウンロードし、SHA-256 を確かめてから置く。置いた uv のパスを返す */
  private async downloadUv(arch: string): Promise<string> {
    const target = UV_TARGET[arch];
    const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`;
    // pkg でバイナリにしたバックエンド（--jitless）では fetch が動かないため、axios を使う
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new Error(
        `uv をダウンロードできませんでした（${response.status}）`,
      );
    }
    const data = Buffer.from(response.data);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== UV_SHA256[arch]) {
      throw new Error('ダウンロードした uv のハッシュが一致しません');
    }

    const workDir = path.join(this.baseDir, 'uv-download');
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(workDir, { recursive: true });
    const archive = path.join(workDir, 'uv.tar.gz');
    await fs.writeFile(archive, data);
    await execFileAsync('/usr/bin/tar', ['-xzf', archive, '-C', workDir]);

    const binDir = path.join(this.baseDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const uvPath = path.join(binDir, 'uv');
    await fs.rename(path.join(workDir, `uv-${target}`, 'uv'), uvPath);
    await fs.chmod(uvPath, 0o755);
    await fs.rm(workDir, { recursive: true, force: true });
    return uvPath;
  }

  private async readMarker(): Promise<InstalledMarker | null> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.markerPath, 'utf-8'),
      ) as Partial<InstalledMarker>;
      if (typeof parsed.requirementsHash !== 'string') return null;
      return {
        requirementsHash: parsed.requirementsHash,
        versions: parsed.versions ?? {},
      };
    } catch {
      return null;
    }
  }
}

/** GiNZA を入れられる環境か（macOS で、uv の配布ファイルがあるアーキテクチャ） */
function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' && UV_TARGET[process.arch] !== undefined;
}
