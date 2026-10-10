import { Inject, Injectable } from '@nestjs/common';
import { TRANSCRIPTION_STORAGE } from '../storage/interfaces/transcription-storage.interface';
import type { TranscriptionStorage } from '../storage/interfaces/transcription-storage.interface';
import { Transcription } from './types/transcription.types';
import { UtteranceEmbeddingStore } from './utterance-embedding-store.service';

/** 文字起こし結果ストレージの薄いラッパー（他モジュールとの互換性を維持） */
@Injectable()
export class TranscriptionStoreService {
  constructor(
    @Inject(TRANSCRIPTION_STORAGE)
    private readonly storage: TranscriptionStorage,
    private readonly utteranceEmbeddingStore: UtteranceEmbeddingStore,
  ) {}

  /** 文字起こし結果を保存 */
  async save(transcription: Transcription): Promise<void> {
    return this.storage.save(transcription);
  }

  /** IDで文字起こし結果を取得 */
  async findById(id: string): Promise<Transcription | null> {
    return this.storage.findById(id);
  }

  /** 全文字起こし結果を取得 */
  async findAll(): Promise<Transcription[]> {
    return this.storage.findAll();
  }

  /** 文字起こし結果と、そこから作った発話ベクトルのキャッシュを削除 */
  async delete(id: string): Promise<void> {
    await this.storage.delete(id);
    await this.utteranceEmbeddingStore.delete(id);
  }
}
