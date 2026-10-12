import { Inject, Injectable } from '@nestjs/common';
import { TRANSCRIPTION_STORAGE } from '../storage/interfaces/transcription-storage.interface';
import type { TranscriptionStorage } from '../storage/interfaces/transcription-storage.interface';
import { Transcription } from './types/transcription.types';
import { UtteranceEmbeddingStore } from './utterance-embedding-store.service';
import { DerivedLogCleaner } from './derived-log-cleaner.service';
import { GinzaKeywordStore } from './ginza-keyword-store.service';
import { PrivacyService } from '../privacy/privacy.service';

/** 文字起こし結果ストレージの薄いラッパー（他モジュールとの互換性を維持） */
@Injectable()
export class TranscriptionStoreService {
  constructor(
    @Inject(TRANSCRIPTION_STORAGE)
    private readonly storage: TranscriptionStorage,
    private readonly utteranceEmbeddingStore: UtteranceEmbeddingStore,
    private readonly derivedLogCleaner: DerivedLogCleaner,
    private readonly ginzaKeywordStore: GinzaKeywordStore,
    private readonly privacyService: PrivacyService,
  ) {}

  /** 文字起こし結果を保存 */
  async save(transcription: Transcription): Promise<void> {
    return this.storage.save(transcription);
  }

  /** IDで文字起こし結果を取得 */
  async findById(id: string): Promise<Transcription | null> {
    return this.storage.findById(id);
  }

  /**
   * 外部（Claude など）に送る用に文字起こしを取得する
   * 個人情報チェックで「伏せる」と選んだ文字列は [氏名] のように置き換える
   */
  async findForSending(id: string): Promise<Transcription | null> {
    const transcription = await this.storage.findById(id);
    return transcription
      ? this.privacyService.maskForSending(transcription)
      : null;
  }

  /** 全文字起こし結果を取得 */
  async findAll(): Promise<Transcription[]> {
    return this.storage.findAll();
  }

  /**
   * 文字起こし結果と、そこから作ったデータ（発話ベクトルと GiNZA のキャッシュ、会話分析・要約・
   * ディープサーチのログ）を削除する。削除した会話の内容をディスクに残さないため
   */
  async delete(id: string): Promise<void> {
    // 派生データを先に削除する。失敗した場合は文字起こしを残し、やり直せるようにする
    await this.derivedLogCleaner.deleteLogsForTranscription(id);
    await this.utteranceEmbeddingStore.delete(id);
    await this.ginzaKeywordStore.delete(id);
    await this.storage.delete(id);
  }
}
