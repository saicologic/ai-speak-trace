import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { DocumentModule } from '../document/document.module';
import { ClaudeModule } from '../claude/claude.module';
import { DeepSearchController } from './deep-search.controller';
import { DeepSearchService } from './deep-search.service';
import { DeepSearchLogStorage } from './deep-search-log.storage';

/** ディープサーチモジュール（会話・PDF・Webの横断検索） */
@Module({
  imports: [TranscriptionModule, DocumentModule, ClaudeModule],
  controllers: [DeepSearchController],
  providers: [DeepSearchService, DeepSearchLogStorage],
})
export class DeepSearchModule {}
