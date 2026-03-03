import { Transcription } from '../../transcription/types/transcription.types';

/** 文字起こし結果ストレージのインターフェース */
export interface TranscriptionStorage {
  /** 文字起こし結果を保存 */
  save(transcription: Transcription): Promise<void>;

  /** IDで文字起こし結果を取得 */
  findById(id: string): Promise<Transcription | null>;

  /** 全文字起こし結果を取得 */
  findAll(): Promise<Transcription[]>;
}

/** DI用のインジェクショントークン */
export const TRANSCRIPTION_STORAGE = Symbol('TRANSCRIPTION_STORAGE');
