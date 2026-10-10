import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { ClaudeModule } from '../claude/claude.module';
import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';
import { ResearchClaudeService } from './research-claude.service';
import { ResearchJobStore } from './research-job.store';

/** ディープサーチ（会話の読み込み→キーワード→Web調査→統合分析→評価）モジュール */
@Module({
  imports: [TranscriptionModule, ClaudeModule],
  controllers: [ResearchController],
  providers: [ResearchService, ResearchClaudeService, ResearchJobStore],
})
export class ResearchModule {}
