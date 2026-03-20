import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { ClaudeModule } from '../claude/claude.module';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';

@Module({
  imports: [TranscriptionModule, ClaudeModule],
  controllers: [InterviewController],
  providers: [InterviewService],
})
export class InterviewModule {}
