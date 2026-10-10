import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { UtteranceEmbeddingStore } from '../transcription/utterance-embedding-store.service';
import { EmbeddingService } from '../document/embedding.service';
import {
  Transcription,
  Utterance,
} from '../transcription/types/transcription.types';
import { DeepSearchResultItem } from './types/deep-search.types';

/** 選択した会話1件あたりに返す発話の最大件数（複数の会話を選んだ場合は件数倍まで） */
export const CONVERSATION_TOP_K = 5;

/** キーワードを含む発話に加点する値（意味の近さ cosine 類似度に足して順位を決める） */
export const KEYWORD_BOOST = 0.1;

/**
 * キーワードを含まない発話を結果に入れるために必要な cosine 類似度の下限
 * 関連する話題がない会話で、無関係な発話を上位N件として返さないための足切り
 */
export const CONVERSATION_MIN_SIMILARITY = 0.4;

/** 順位付けの候補 */
interface RankedUtterance {
  transcription: Transcription;
  utterance: Utterance;
  similarity: number;
  rankScore: number;
}

/**
 * 会話（文字起こし）から、キーワードに関連する発話を関連度順に検索するサービス
 *
 * キーワードの完全一致だけでは、よく出てくる用語で無関係な発話が大量に混ざり、
 * 言い換えられた発話は見つからない。発話をベクトル化して意味の近さで順位を付け、
 * キーワードを含む発話には加点したうえで上位の発話を返す。
 * 結果に入れるのは「キーワードを含む」か「類似度が下限以上」の発話だけにする。
 * ベクトル化に失敗した場合（AWS 未設定など）はキーワードの完全一致にフォールバックする。
 */
@Injectable()
export class ConversationSearchService {
  private readonly logger = new Logger(ConversationSearchService.name);

  constructor(
    private readonly transcriptionStore: TranscriptionStoreService,
    private readonly utteranceEmbeddingStore: UtteranceEmbeddingStore,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /** 指定した会話からキーワードに関連する発話を検索する */
  async search(
    keywords: string[],
    transcriptionIds: string[],
  ): Promise<DeepSearchResultItem[]> {
    const transcriptions: Transcription[] = [];
    for (const id of transcriptionIds) {
      const transcription = await this.transcriptionStore.findById(id);
      if (transcription) transcriptions.push(transcription);
    }
    if (transcriptions.length === 0) return [];

    let queryVector: number[];
    try {
      queryVector = await this.embeddingService.generateEmbedding(
        keywords.join(' '),
      );
    } catch (error) {
      this.logger.warn(
        '検索語のベクトル化に失敗したため、キーワード一致で検索します',
        error,
      );
      return transcriptions.flatMap((t) => this.searchByKeyword(keywords, t));
    }

    // 選択したすべての会話の候補をまとめて関連度順に並べる
    const candidates: RankedUtterance[] = [];
    const keywordResults: DeepSearchResultItem[] = [];
    for (const transcription of transcriptions) {
      try {
        const embeddings = await this.getUtteranceEmbeddings(transcription);
        candidates.push(
          ...this.scoreUtterances(
            keywords,
            queryVector,
            transcription,
            embeddings,
          ),
        );
      } catch (error) {
        this.logger.warn(
          `発話のベクトル化に失敗したため、キーワード一致で検索します: ${transcription.id}`,
          error,
        );
        keywordResults.push(...this.searchByKeyword(keywords, transcription));
      }
    }

    const ranked = candidates
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, CONVERSATION_TOP_K * transcriptions.length)
      .map(({ transcription, utterance, similarity }) => ({
        ...this.toResultItem(transcription, utterance),
        // 画面に「関連度」として表示するため 0〜1 に収める
        score: Math.max(0, similarity),
      }));

    const results = [...ranked, ...keywordResults];
    this.logger.log(`会話検索完了: ${results.length}件`);
    return results;
  }

  /** 発話ごとに類似度と順位付け用のスコアを計算し、結果に入れる候補だけを返す */
  private scoreUtterances(
    keywords: string[],
    queryVector: number[],
    transcription: Transcription,
    embeddings: number[][],
  ): RankedUtterance[] {
    const candidates: RankedUtterance[] = [];
    transcription.utterances.forEach((utterance, index) => {
      if (!utterance.text.trim()) return;
      // ベクトルは正規化済みのため内積が cosine 類似度になる
      const similarity = dot(queryVector, embeddings[index]);
      const hasKeyword = keywords.some((kw) => utterance.text.includes(kw));
      if (!hasKeyword && similarity < CONVERSATION_MIN_SIMILARITY) return;
      candidates.push({
        transcription,
        utterance,
        similarity,
        rankScore: similarity + (hasKeyword ? KEYWORD_BOOST : 0),
      });
    });
    return candidates;
  }

  /** キーワードを含む発話をすべて返す（ベクトル化できない場合のフォールバック） */
  private searchByKeyword(
    keywords: string[],
    transcription: Transcription,
  ): DeepSearchResultItem[] {
    return transcription.utterances
      .filter((utterance) => keywords.some((kw) => utterance.text.includes(kw)))
      .map((utterance) => this.toResultItem(transcription, utterance));
  }

  /** 発話を検索結果の形式にする */
  private toResultItem(
    transcription: Transcription,
    utterance: Utterance,
  ): DeepSearchResultItem {
    return {
      sourceType: 'conversation',
      sourceName: `${transcription.audioFileName} - ${utterance.speakerName}`,
      sourceId: transcription.id,
      text: utterance.text,
      speakerName: utterance.speakerName,
    };
  }

  /** 発話ベクトルをキャッシュから取得し、なければ生成して保存する */
  private async getUtteranceEmbeddings(
    transcription: Transcription,
  ): Promise<number[][]> {
    const texts = transcription.utterances.map((u) => u.text);
    const textsHash = createHash('sha256')
      .update(JSON.stringify(texts))
      .digest('hex');
    const modelId = this.embeddingService.getModelId();
    const dimensions = this.embeddingService.getDimensions();

    const cache = await this.utteranceEmbeddingStore.find(transcription.id);
    if (
      cache &&
      cache.modelId === modelId &&
      cache.dimensions === dimensions &&
      cache.textsHash === textsHash &&
      cache.embeddings.length === texts.length
    ) {
      return cache.embeddings;
    }

    // 空文字はベクトル化できないため、ゼロベクトルで埋める（順位付けの対象からも外す）
    const nonEmptyIndices = texts
      .map((t, i) => (t.trim() ? i : -1))
      .filter((i) => i >= 0);
    const generated = await this.embeddingService.generateEmbeddings(
      nonEmptyIndices.map((i) => texts[i]),
    );
    const embeddings: number[][] = texts.map(() =>
      new Array<number>(dimensions).fill(0),
    );
    nonEmptyIndices.forEach((textIndex, i) => {
      embeddings[textIndex] = generated[i];
    });

    // 保存に失敗しても、生成したベクトルで検索は続ける（次回の検索で作り直す）
    try {
      await this.utteranceEmbeddingStore.save(transcription.id, {
        modelId,
        dimensions,
        textsHash,
        embeddings,
      });
    } catch (error) {
      this.logger.warn(
        `発話ベクトルのキャッシュを保存できません: ${transcription.id}`,
        error,
      );
    }
    this.logger.log(
      `発話ベクトルを生成しました: ${transcription.id}（${embeddings.length}件）`,
    );
    return embeddings;
  }
}

/** ベクトルの内積 */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
