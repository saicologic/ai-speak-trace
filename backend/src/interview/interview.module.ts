import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { ClaudeService } from './claude.service';

@Module({
  imports: [TranscriptionModule],
  controllers: [InterviewController],
  providers: [InterviewService, ClaudeService],
})
export class InterviewModule {}
