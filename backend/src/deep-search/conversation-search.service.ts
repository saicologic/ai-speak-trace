import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { EmbeddingService } from '../document/embedding.service';
import { Transcription } from '../transcription/types/transcription.types';
import { DeepSearchResultItem } from './types/deep-search.types';

/** 1つの会話から返す発話の最大件数 */
export const CONVERSATION_TOP_K = 5;

/** キーワードを含む発話に加点する値（意味の近さ cosine 類似度に足して順位を決める） */
export const KEYWORD_BOOST = 0.1;

/** 発話ベクトルのキャッシュ（文字起こしごとに1ファイル） */
interface UtteranceEmbeddingCache {
  modelId: string;
  dimensions: number;
  /** 発話テキストのハッシュ。文字起こしが編集されたら作り直す */
  textsHash: string;
  embeddings: number[][];
}

/**
 * 会話（文字起こし）から、キーワードに関連する発話を関連度順に検索するサービス
 *
 * キーワードの完全一致だけでは、よく出てくる用語で無関係な発話が大量に混ざり、
 * 言い換えられた発話は見つからない。発話をベクトル化して意味の近さで順位を付け、
 * キーワードを含む発話には加点したうえで上位 CONVERSATION_TOP_K 件を返す。
 * ベクトル化に失敗した場合（AWS 未設定など）はキーワードの完全一致にフォールバックする。
 */
@Injectable()
export class ConversationSearchService {
  private readonly logger = new Logger(ConversationSearchService.name);
  private readonly cacheDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly transcriptionStore: TranscriptionStoreService,
    private readonly embeddingService: EmbeddingService,
  ) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.cacheDir = path.resolve(path.join(dataDir, 'utterance-embeddings'));
  }

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

    const results: DeepSearchResultItem[] = [];
    for (const transcription of transcriptions) {
      try {
        const embeddings = await this.getUtteranceEmbeddings(transcription);
        results.push(
          ...this.rankUtterances(
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
        results.push(...this.searchByKeyword(keywords, transcription));
      }
    }

    this.logger.log(`会話検索完了: ${results.length}件`);
    return results;
  }

  /** 意味の近さ + キーワード加点で発話を並べ、上位を返す */
  private rankUtterances(
    keywords: string[],
    queryVector: number[],
    transcription: Transcription,
    embeddings: number[][],
  ): DeepSearchResultItem[] {
    return transcription.utterances
      .map((utterance, index) => {
        // ベクトルは正規化済みのため内積が cosine 類似度になる
        const similarity = dot(queryVector, embeddings[index]);
        const hasKeyword = keywords.some((kw) => utterance.text.includes(kw));
        return {
          utterance,
          similarity,
          rankScore: similarity + (hasKeyword ? KEYWORD_BOOST : 0),
        };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, CONVERSATION_TOP_K)
      .map(({ utterance, similarity }) => ({
        sourceType: 'conversation' as const,
        sourceName: `${transcription.audioFileName} - ${utterance.speakerName}`,
        sourceId: transcription.id,
        text: utterance.text,
        score: similarity,
        speakerName: utterance.speakerName,
      }));
  }

  /** キーワードを含む発話をすべて返す（ベクトル化できない場合のフォールバック） */
  private searchByKeyword(
    keywords: string[],
    transcription: Transcription,
  ): DeepSearchResultItem[] {
    return transcription.utterances
      .filter((utterance) => keywords.some((kw) => utterance.text.includes(kw)))
      .map((utterance) => ({
        sourceType: 'conversation' as const,
        sourceName: `${transcription.audioFileName} - ${utterance.speakerName}`,
        sourceId: transcription.id,
        text: utterance.text,
        speakerName: utterance.speakerName,
      }));
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
    const cachePath = path.join(
      this.cacheDir,
      `${path.basename(transcription.id)}.json`,
    );

    if (existsSync(cachePath)) {
      try {
        const cache = JSON.parse(
          await fs.readFile(cachePath, 'utf-8'),
        ) as UtteranceEmbeddingCache;
        if (
          cache.modelId === modelId &&
          cache.dimensions === dimensions &&
          cache.textsHash === textsHash
        ) {
          return cache.embeddings;
        }
      } catch (error) {
        this.logger.warn(
          `発話ベクトルのキャッシュを読めません: ${cachePath}`,
          error,
        );
      }
    }

    // 空文字はベクトル化できないため、類似度0になるゼロベクトルで埋める
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
    const cache: UtteranceEmbeddingCache = {
      modelId,
      dimensions,
      textsHash,
      embeddings,
    };
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache), 'utf-8');
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
