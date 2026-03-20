import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/** Bedrock Titan v2によるEmbedding生成サービス */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly dimensions: number;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-1',
    );
    this.modelId = this.configService.get<string>(
      'BEDROCK_EMBEDDING_MODEL',
      'amazon.titan-embed-text-v2:0',
    );
    this.dimensions = Number(
      this.configService.get('BEDROCK_EMBEDDING_DIMENSIONS', '256'),
    );

    this.client = new BedrockRuntimeClient({ region });
    this.logger.log(
      `Embeddingサービス初期化: model=${this.modelId}, dimensions=${this.dimensions}`,
    );
  }

  /** テキストをベクトルに変換 */
  async generateEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: this.dimensions,
        normalize: true,
      }),
    });

    const response = await this.client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.embedding as number[];
  }

  /** 複数テキストを一括でベクトルに変換（同時5件制限） */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const CONCURRENCY = 5;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += CONCURRENCY) {
      const batch = texts.slice(i, i + CONCURRENCY);
      const embeddings = await Promise.all(
        batch.map((text) => this.generateEmbedding(text)),
      );
      results.push(...embeddings);
    }

    this.logger.log(`Embedding生成完了: ${results.length}件`);
    return results;
  }

  /** Embedding次元数を返す */
  getDimensions(): number {
    return this.dimensions;
  }
}
