import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
  ListVectorsCommand,
  GetIndexCommand,
} from '@aws-sdk/client-s3vectors';
import { VectorSearchResult } from './types/document.types';
import { awsCredentials } from '../aws/aws-credentials';

/** S3 Vectorsによるベクトル保存・検索サービス */
@Injectable()
export class VectorSearchService implements OnModuleInit {
  private readonly logger = new Logger(VectorSearchService.name);
  private readonly client: S3VectorsClient;
  private readonly vectorBucketName: string;
  private readonly indexName: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-1',
    );
    this.vectorBucketName = this.configService.get<string>(
      'S3_VECTORS_BUCKET',
      '',
    );
    this.indexName = this.configService.get<string>(
      'S3_VECTORS_INDEX',
      'documents',
    );

    this.client = new S3VectorsClient({
      region,
      credentials: awsCredentials(),
    });
    this.logger.log(
      `S3 Vectorsサービス初期化: bucket=${this.vectorBucketName}, index=${this.indexName}`,
    );
  }

  onModuleInit(): void {
    // 起動をブロックしないよう、確認結果は待たずにバックグラウンドで実行する
    void this.verifyDistanceMetric();
  }

  /**
   * インデックスの距離指標がcosineであることを確認する
   * search()はcosine距離を前提にスコアを算出するため、それ以外の場合は警告を出す
   */
  async verifyDistanceMetric(): Promise<void> {
    if (!this.vectorBucketName) {
      // S3 Vectors未設定（PDF検索を使わない構成）の場合は確認しない
      return;
    }
    try {
      const response = await this.client.send(
        new GetIndexCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
        }),
      );
      const metric = response.index?.distanceMetric;
      if (metric === 'cosine') {
        this.logger.log(`インデックスの距離指標を確認: ${metric}`);
      } else {
        this.logger.warn(
          `インデックス ${this.indexName} の距離指標が ${metric ?? '不明'} です。PDF検索の関連度はcosine距離を前提に算出しているため、正しく表示されません。cosineでインデックスを再作成してください`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `インデックスの距離指標を確認できませんでした: ${(error as Error).message}`,
      );
    }
  }

  /** ベクトルを一括保存（最大500件ずつ） */
  async putVectors(
    items: {
      key: string;
      vector: number[];
      metadata: Record<string, string>;
    }[],
  ): Promise<void> {
    const BATCH_SIZE = 500;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      await this.client.send(
        new PutVectorsCommand({
          vectorBucketName: this.vectorBucketName,
          indexName: this.indexName,
          vectors: batch.map((item) => ({
            key: item.key,
            data: { float32: item.vector },
            metadata: item.metadata,
          })),
        }),
      );

      this.logger.log(
        `ベクトル保存: ${i + batch.length}/${items.length}件完了`,
      );
    }
  }

  /** ベクトル類似検索 */
  async search(
    queryVector: number[],
    topK: number = 10,
  ): Promise<VectorSearchResult[]> {
    const response = await this.client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        queryVector: { float32: queryVector },
        topK,
        returnMetadata: true,
        returnDistance: true,
      }),
    );

    const results: VectorSearchResult[] = [];
    for (const vector of response.vectors ?? []) {
      const metadata = vector.metadata ?? {};
      results.push({
        text: metadata['text'] ?? '',
        // S3 Vectorsのdistanceはcosine距離（0〜2、小さいほど類似）のため、
        // 1から引いてcosine類似度（1に近いほど類似）に変換する
        score: 1 - (vector.distance ?? 1),
        documentId: metadata['documentId'] ?? '',
        fileName: metadata['fileName'] ?? '',
        chunkIndex: parseInt(metadata['chunkIndex'] ?? '0', 10),
      });
    }

    return results;
  }

  /** ドキュメントIDに紐づくベクトルを全削除 */
  async deleteByDocumentId(documentId: string): Promise<void> {
    // ドキュメントIDをプレフィックスとしてベクトルを検索して削除
    const response = await this.client.send(
      new ListVectorsCommand({
        vectorBucketName: this.vectorBucketName,
        indexName: this.indexName,
        segmentCount: 1,
        segmentIndex: 0,
      }),
    );

    const keysToDelete = (response.vectors ?? [])
      .filter((v) => v.key?.startsWith(`${documentId}_`))
      .map((v) => v.key!);

    if (keysToDelete.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        await this.client.send(
          new DeleteVectorsCommand({
            vectorBucketName: this.vectorBucketName,
            indexName: this.indexName,
            keys: batch,
          }),
        );
      }
      this.logger.log(
        `ベクトル削除完了: documentId=${documentId}, ${keysToDelete.length}件`,
      );
    }
  }
}
