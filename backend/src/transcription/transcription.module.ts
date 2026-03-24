import { Module } from '@nestjs/common';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { JobManagerService } from './job-manager.service';

@Module({
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    ElevenLabsService,
    TranscriptionStoreService,
    JobManagerService,
  ],
  exports: [TranscriptionStoreService, TranscriptionService],
})
export class TranscriptionModule {}
