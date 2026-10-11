import { execFileSync } from 'child_process';
import * as fs from 'fs';

/** API キーの保存先（macOS のキーチェーンの項目のサービス名） */
export const KEYCHAIN_SERVICE = 'io.github.saicologic.ai-speak-trace';

const SECURITY_COMMAND = '/usr/bin/security';

/** security コマンドの「項目が見つからない」の終了コード */
const ITEM_NOT_FOUND = 44;

/**
 * キーチェーンに保存できる値か
 * security -i に渡すコマンドの文字列に埋め込むため、引用符・空白・改行を含む値は受け付けない
 * （ElevenLabs・Anthropic の API キーは英数字と - _ . だけでできている）
 */
const SAFE_VALUE = /^[A-Za-z0-9_.-]+$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * API キーを macOS のキーチェーンに保存するストア
 *
 * settings.json に平文で保存しないため、macOS の security コマンドでキーチェーンに保存する。
 * 値はコマンドライン引数に載せず（ps で見えるため）、security -i の標準入力から渡す。
 * macOS 以外の環境と、環境変数 SECRET_STORE=file を指定した場合（テストなど）は使わない。
 */
export class KeychainSecretStore {
  constructor(private readonly service: string = KEYCHAIN_SERVICE) {}

  /** キーチェーンを使えるか */
  static isAvailable(): boolean {
    return (
      process.platform === 'darwin' &&
      process.env.SECRET_STORE !== 'file' &&
      fs.existsSync(SECURITY_COMMAND)
    );
  }

  /** 値を読む（保存されていなければ null） */
  get(name: string): string | null {
    assertSafeName(name);
    try {
      const value = execFileSync(
        SECURITY_COMMAND,
        ['find-generic-password', '-s', this.service, '-a', name, '-w'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return value.replace(/\n$/, '') || null;
    } catch (error) {
      if ((error as { status?: number }).status === ITEM_NOT_FOUND) return null;
      throw new Error(`キーチェーンから読めませんでした: ${name}`);
    }
  }

  /** 値を保存する（同じ名前の値があれば置き換える）。保存後に読み直して確かめる */
  set(name: string, value: string): void {
    assertSafeName(name);
    if (!SAFE_VALUE.test(value)) {
      throw new Error(
        'API キーに使えない文字が含まれています（英数字と - _ . だけが使えます）',
      );
    }
    execFileSync(SECURITY_COMMAND, ['-i'], {
      input: `add-generic-password -U -s "${this.service}" -a "${name}" -w "${value}"\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    // security -i はコマンドが失敗しても終了コードが 0 のため、読み直して確かめる
    if (this.get(name) !== value) {
      throw new Error(`キーチェーンに保存できませんでした: ${name}`);
    }
  }

  /** 値を削除する（保存されていなければ何もしない） */
  delete(name: string): void {
    assertSafeName(name);
    try {
      execFileSync(
        SECURITY_COMMAND,
        ['delete-generic-password', '-s', this.service, '-a', name],
        { stdio: 'ignore' },
      );
    } catch (error) {
      if ((error as { status?: number }).status === ITEM_NOT_FOUND) return;
      throw new Error(`キーチェーンから削除できませんでした: ${name}`);
    }
  }
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `キーチェーンの項目名に使えない文字が含まれています: ${name}`,
    );
  }
}
