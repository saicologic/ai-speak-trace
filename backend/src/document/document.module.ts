import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { EmbeddingService } from './embedding.service';
import { VectorSearchService } from './vector-search.service';

/** PDFドキュメント管理モジュール */
@Module({
  controllers: [DocumentController],
  providers: [DocumentService, EmbeddingService, VectorSearchService],
  exports: [DocumentService, EmbeddingService, VectorSearchService],
})
export class DocumentModule {}
