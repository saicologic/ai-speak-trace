import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { FeedbackStore } from './feedback.store';

/** AI が生成した結果への、誤りの報告のモジュール */
@Module({
  imports: [TranscriptionModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackStore],
})
export class FeedbackModule {}
