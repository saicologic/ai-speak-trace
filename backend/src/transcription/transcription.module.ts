import { Module } from '@nestjs/common';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { AudioSplitterService } from './audio-splitter.service';
import { ChunkedTranscriptionService } from './chunked-transcription.service';
import { ChunkedJobStoreService } from './chunked-job-store.service';

@Module({
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    ElevenLabsService,
    TranscriptionStoreService,
    AudioSplitterService,
    ChunkedTranscriptionService,
    ChunkedJobStoreService,
  ],
  exports: [TranscriptionStoreService, TranscriptionService],
})
export class TranscriptionModule {}
