import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

/** GiNZA で取り出した語のキャッシュ（文字起こしごとに1ファイル） */
export interface GinzaKeywordCache {
  /** 解析に使ったパッケージの一覧のハッシュ。GiNZA を入れ直したら作り直す */
  engineHash: string;
  /** 発話テキストのハッシュ。文字起こしが編集されたら作り直す */
  textsHash: string;
  /** 発話ごとの [正規化した語, 表記] の一覧 */
  terms: [string, string][][];
}

/**
 * GiNZA で取り出した語をローカルファイルに保存するストア
 * 文字起こしから作った派生データのため、文字起こしの削除時に一緒に削除する
 */
@Injectable()
export class GinzaKeywordStore {
  private readonly logger = new Logger(GinzaKeywordStore.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, 'ginza-keywords'));
  }

  /** キャッシュファイルのパス（パストラバーサル対策でファイル名部分のみ使う） */
  private getFilePath(transcriptionId: string): string {
    return path.join(this.storeDir, `${path.basename(transcriptionId)}.json`);
  }

  /** キャッシュを読み込む。存在しない・壊れている・形式が不正な場合は null */
  async find(transcriptionId: string): Promise<GinzaKeywordCache | null> {
    const filePath = this.getFilePath(transcriptionId);
    if (!existsSync(filePath)) return null;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      if (!isGinzaKeywordCache(parsed)) {
        this.logger.warn(`GiNZA のキャッシュの形式が不正です: ${filePath}`);
        return null;
      }
      return parsed;
    } catch (error) {
      this.logger.warn(`GiNZA のキャッシュを読めません: ${filePath}`, error);
      return null;
    }
  }

  /** キャッシュを保存する（書き込み途中のファイルを読まれないよう、一時ファイルから置き換える） */
  async save(transcriptionId: string, cache: GinzaKeywordCache): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.getFilePath(transcriptionId);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(cache), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  /** キャッシュを削除する（存在しなければ何もしない） */
  async delete(transcriptionId: string): Promise<void> {
    await fs.rm(this.getFilePath(transcriptionId), { force: true });
  }
}

/** 読み込んだ値がキャッシュの形か */
export function isGinzaKeywordCache(
  value: unknown,
): value is GinzaKeywordCache {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<GinzaKeywordCache>;
  return (
    typeof c.engineHash === 'string' &&
    typeof c.textsHash === 'string' &&
    Array.isArray(c.terms) &&
    c.terms.every(
      (list) =>
        Array.isArray(list) &&
        list.every(
          (t) =>
            Array.isArray(t) &&
            t.length === 2 &&
            typeof t[0] === 'string' &&
            typeof t[1] === 'string',
        ),
    )
  );
}
