import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { DocumentModule } from '../document/document.module';
import { ClaudeModule } from '../claude/claude.module';
import { DeepSearchController } from './deep-search.controller';
import { DeepSearchService } from './deep-search.service';

/** ディープサーチモジュール（会話・PDF・Webの横断検索） */
@Module({
  imports: [TranscriptionModule, DocumentModule, ClaudeModule],
  controllers: [DeepSearchController],
  providers: [DeepSearchService],
})
export class DeepSearchModule {}
