import { AudioFileInfo } from '../../transcription/types/transcription.types';

/** 音声ファイルストレージのインターフェース */
export interface AudioStorage {
  /** 音声ファイル一覧を取得 */
  listFiles(): Promise<AudioFileInfo[]>;

  /** 音声ファイルの存在確認 */
  exists(fileName: string): Promise<boolean>;

  /** 音声ファイルの内容をBufferとして読み込み */
  readFile(fileName: string): Promise<Buffer>;

  /** 音声ファイルの再生用URLを取得 */
  getPlaybackUrl(fileName: string): Promise<string>;

  /** 音声ファイルを保存 */
  saveFile(fileName: string, buffer: Buffer): Promise<void>;
}

/** DI用のインジェクショントークン */
export const AUDIO_STORAGE = Symbol('AUDIO_STORAGE');
