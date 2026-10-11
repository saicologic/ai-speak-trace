import { Module } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';
import { AnalysisService } from './analysis.service';
import { SummaryService } from './summary.service';
import { ClaudeAuditStore } from './claude-audit.store';
import { PrivacyModule } from '../privacy/privacy.module';

/** Claude API共有モジュール */
@Module({
  imports: [PrivacyModule],
  providers: [
    ClaudeClientService,
    ClaudeAuditStore,
    AnalysisService,
    SummaryService,
  ],
  exports: [ClaudeClientService, AnalysisService, SummaryService],
})
export class ClaudeModule {}
