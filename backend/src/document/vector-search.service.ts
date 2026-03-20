import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
  ListVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { VectorSearchResult } from './types/document.types';

/** S3 Vectorsによるベクトル保存・検索サービス */
@Injectable()
export class VectorSearchService {
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

    this.client = new S3VectorsClient({ region });
    this.logger.log(
      `S3 Vectorsサービス初期化: bucket=${this.vectorBucketName}, index=${this.indexName}`,
    );
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
        score: vector.distance ?? 0,
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
