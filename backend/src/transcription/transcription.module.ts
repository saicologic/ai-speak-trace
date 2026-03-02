import { Module } from '@nestjs/common';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';

@Module({
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    ElevenLabsService,
    TranscriptionStoreService,
  ],
})
export class TranscriptionModule {}
