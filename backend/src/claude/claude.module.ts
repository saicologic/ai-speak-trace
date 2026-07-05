import { Module } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';
import { AnalysisService } from './analysis.service';
import { SummaryService } from './summary.service';

/** Claude API共有モジュール */
@Module({
  providers: [ClaudeClientService, AnalysisService, SummaryService],
  exports: [AnalysisService, SummaryService],
})
export class ClaudeModule {}
