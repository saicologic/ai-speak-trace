import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PDFParse } from 'pdf-parse';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
} from '../storage/interfaces/document-storage.interface';
import { DocumentMetadata, DocumentChunk } from './types/document.types';
import { EmbeddingService } from './embedding.service';
import { VectorSearchService } from './vector-search.service';

/** チャンク分割の設定 */
const CHUNK_TARGET_SIZE = 500;
const CHUNK_OVERLAP = 100;
const CHUNK_MIN_SIZE = 50;

/** PDF処理パイプラインを担当するサービス */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(DOCUMENT_STORAGE)
    private readonly storage: DocumentStorage,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorSearchService: VectorSearchService,
  ) {}

  /** PDFをアップロードし、非同期で処理を開始 */
  async upload(
    fileName: string,
    buffer: Buffer,
    sizeBytes: number,
  ): Promise<DocumentMetadata> {
    const id = uuidv4();
    const metadata: DocumentMetadata = {
      id,
      fileName,
      sizeBytes,
      status: 'processing',
      chunkCount: 0,
      createdAt: new Date().toISOString(),
    };

    // ファイルとメタデータを保存
    await this.storage.saveFile(id, fileName, buffer);
    await this.storage.saveMetadata(metadata);

    // 非同期でPDF処理を開始
    this.processDocument(id, buffer).catch((error) => {
      this.logger.error(`PDF処理に失敗: ${id}`, error);
    });

    return metadata;
  }

  /** ドキュメント一覧を取得 */
  async listDocuments(): Promise<DocumentMetadata[]> {
    return this.storage.findAllMetadata();
  }

  /** ドキュメントのステータスを取得 */
  async getStatus(id: string): Promise<DocumentMetadata> {
    const metadata = await this.storage.findMetadataById(id);
    if (!metadata) {
      throw new NotFoundException(`ドキュメントが見つかりません: ${id}`);
    }
    return metadata;
  }

  /** ドキュメントを削除（ファイル・メタデータ・ベクトル） */
  async deleteDocument(id: string): Promise<void> {
    const metadata = await this.storage.findMetadataById(id);
    if (!metadata) {
      throw new NotFoundException(`ドキュメントが見つかりません: ${id}`);
    }

    // ベクトルを削除
    try {
      await this.vectorSearchService.deleteByDocumentId(id);
    } catch (error) {
      this.logger.warn(`ベクトル削除に失敗（スキップ）: ${id}`, error);
    }

    // ファイルとメタデータを削除
    await this.storage.deleteFile(id);
    await this.storage.deleteMetadata(id);

    this.logger.log(`ドキュメント削除完了: ${id}`);
  }

  /** PDF処理パイプライン（テキスト抽出→チャンク分割→Embedding→ベクトル保存） */
  private async processDocument(id: string, buffer: Buffer): Promise<void> {
    try {
      this.logger.log(`PDF処理開始: ${id}`);

      // 1. テキスト抽出
      const parser = new PDFParse({ data: buffer });
      const pdfData = await parser.getText();
      const text = pdfData.pages.map((p) => p.text).join('\n\n');
      this.logger.log(
        `テキスト抽出完了: ${text.length}文字, ${pdfData.total}ページ`,
      );

      // 2. チャンク分割
      const chunks = this.chunkText(id, text);
      this.logger.log(`チャンク分割完了: ${chunks.length}件`);

      // 3. Embedding生成
      const chunkTexts = chunks.map((c) => c.text);
      const embeddings =
        await this.embeddingService.generateEmbeddings(chunkTexts);

      // 4. ベクトル保存
      const metadata = await this.storage.findMetadataById(id);
      const fileName = metadata?.fileName ?? '';

      // S3 Vectorsのメタデータは最大2048バイト
      // documentId(36) + fileName + chunkIndex + キー名等で約200バイト確保
      const MAX_TEXT_BYTES = 1800;
      const vectorItems = chunks.map((chunk, i) => ({
        key: `${id}_${chunk.chunkIndex}`,
        vector: embeddings[i],
        metadata: {
          text: this.truncateToBytes(chunk.text, MAX_TEXT_BYTES),
          documentId: id,
          fileName: fileName.slice(0, 100),
          chunkIndex: String(chunk.chunkIndex),
        },
      }));
      await this.vectorSearchService.putVectors(vectorItems);

      // 5. ステータス更新
      const updatedMetadata = await this.storage.findMetadataById(id);
      if (updatedMetadata) {
        updatedMetadata.status = 'searchable';
        updatedMetadata.chunkCount = chunks.length;
        updatedMetadata.processedAt = new Date().toISOString();
        await this.storage.saveMetadata(updatedMetadata);
      }

      this.logger.log(`PDF処理完了: ${id}, ${chunks.length}チャンク`);
    } catch (error: any) {
      this.logger.error(`PDF処理に失敗: ${id}`, error);

      // エラーステータスに更新
      const metadata = await this.storage.findMetadataById(id);
      if (metadata) {
        metadata.status = 'error';
        metadata.errorMessage = error.message ?? '処理中にエラーが発生しました';
        await this.storage.saveMetadata(metadata);
      }
    }
  }

  /** テキストをチャンクに分割（段落→文→文字の順で分割、オーバーラップ付き） */
  private chunkText(documentId: string, fullText: string): DocumentChunk[] {
    // 段落で分割
    const paragraphs = fullText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // 段落を適切なサイズのチャンクに組み立て
    const rawChunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (paragraph.length > CHUNK_TARGET_SIZE) {
        // 段落が長すぎる場合は文で分割
        if (currentChunk.length > 0) {
          rawChunks.push(currentChunk);
          currentChunk = '';
        }
        const sentences = this.splitIntoSentences(paragraph);
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if (
            sentenceChunk.length + sentence.length >
            CHUNK_TARGET_SIZE
          ) {
            if (sentenceChunk.length >= CHUNK_MIN_SIZE) {
              rawChunks.push(sentenceChunk);
            }
            // オーバーラップ: 前のチャンクの末尾を引き継ぐ
            sentenceChunk =
              sentenceChunk.length > CHUNK_OVERLAP
                ? sentenceChunk.slice(-CHUNK_OVERLAP) + sentence
                : sentence;
          } else {
            sentenceChunk += sentence;
          }
        }
        if (sentenceChunk.length >= CHUNK_MIN_SIZE) {
          rawChunks.push(sentenceChunk);
        }
      } else if (
        currentChunk.length + paragraph.length + 1 >
        CHUNK_TARGET_SIZE
      ) {
        // 現在のチャンクに追加すると超える場合
        if (currentChunk.length >= CHUNK_MIN_SIZE) {
          rawChunks.push(currentChunk);
        }
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + paragraph;
      }
    }

    // 残りを追加
    if (currentChunk.length >= CHUNK_MIN_SIZE) {
      rawChunks.push(currentChunk);
    }

    // DocumentChunk型に変換
    return rawChunks.map((text, index) => ({
      id: `${documentId}_${index}`,
      documentId,
      text,
      chunkIndex: index,
    }));
  }

  /** テキストを日本語の文に分割 */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/(?<=[。！？!?])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /** テキストを指定バイト数以内に切り詰め（UTF-8） */
  private truncateToBytes(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    if (encoded.length <= maxBytes) return text;

    // バイト単位で切り詰めてデコード
    const truncated = encoded.slice(0, maxBytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(truncated).replace(/\uFFFD$/, '');
  }
}
