import { Module } from '@nestjs/common';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { AudioSplitterService } from './audio-splitter.service';
import { ChunkedTranscriptionService } from './chunked-transcription.service';
import { ChunkedJobStoreService } from './chunked-job-store.service';
import { UtteranceEmbeddingStore } from './utterance-embedding-store.service';
import { DerivedLogCleaner } from './derived-log-cleaner.service';
import { GinzaKeywordStore } from './ginza-keyword-store.service';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  imports: [PrivacyModule],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    ElevenLabsService,
    TranscriptionStoreService,
    AudioSplitterService,
    ChunkedTranscriptionService,
    ChunkedJobStoreService,
    UtteranceEmbeddingStore,
    DerivedLogCleaner,
    GinzaKeywordStore,
  ],
  exports: [
    TranscriptionStoreService,
    TranscriptionService,
    UtteranceEmbeddingStore,
    GinzaKeywordStore,
  ],
})
export class TranscriptionModule {}
