import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { ClaudeModule } from '../claude/claude.module';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { AnalysisLogStorage } from './analysis-log.storage';

@Module({
  imports: [TranscriptionModule, ClaudeModule],
  controllers: [InterviewController],
  providers: [InterviewService, AnalysisLogStorage],
})
export class InterviewModule {}
