import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { ChunkedTranscriptionService } from './chunked-transcription.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { AUDIO_STORAGE } from '../storage/interfaces/audio-storage.interface';

/** テスト用の文字起こしデータを生成するヘルパー */
function makeTranscription(id = 'test-audio', audioFileName = 'test-audio.mp3') {
  return {
    id,
    audioFileName,
    createdAt: '2024-01-01T00:00:00.000Z',
    languageCode: 'ja',
    fullText: 'こんにちは 世界',
    speakers: [
      { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
      { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
    ],
    words: [
      { text: 'こんにちは', start: 0, end: 1, type: 'word' as const, speakerId: 'speaker_0' },
      { text: '世界', start: 1, end: 2, type: 'word' as const, speakerId: 'speaker_1' },
    ],
    utterances: [
      {
        speakerId: 'speaker_0',
        speakerName: 'Aさん',
        start: 0,
        end: 1,
        text: 'こんにちは',
        words: [{ text: 'こんにちは', start: 0, end: 1, type: 'word' as const, speakerId: 'speaker_0' }],
      },
      {
        speakerId: 'speaker_1',
        speakerName: 'Bさん',
        start: 1,
        end: 2,
        text: '世界',
        words: [{ text: '世界', start: 1, end: 2, type: 'word' as const, speakerId: 'speaker_1' }],
      },
    ],
  };
}

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let elevenLabsService: jest.Mocked<ElevenLabsService>;
  let chunkedTranscriptionService: jest.Mocked<ChunkedTranscriptionService>;
  let store: jest.Mocked<TranscriptionStoreService>;
  let audioStorage: {
    listFiles: jest.Mock;
    exists: jest.Mock;
    readFile: jest.Mock;
    getPlaybackUrl: jest.Mock;
    getUploadUrl: jest.Mock;
    saveFile: jest.Mock;
    deleteFile: jest.Mock;
  };

  beforeEach(async () => {
    audioStorage = {
      listFiles: jest.fn(),
      exists: jest.fn(),
      readFile: jest.fn(),
      getPlaybackUrl: jest.fn(),
      getUploadUrl: jest.fn(),
      saveFile: jest.fn(),
      deleteFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionService,
        {
          provide: ElevenLabsService,
          useValue: {
            transcribe: jest.fn(),
          },
        },
        {
          provide: ChunkedTranscriptionService,
          useValue: {
            createJob: jest.fn(),
            deleteJob: jest.fn(),
            findAllJobsByFileName: jest.fn(),
            findActiveJobByFileName: jest.fn(),
            getJobStatus: jest.fn(),
            saveJob: jest.fn(),
            isJobProcessing: jest.fn(),
            needsChunking: jest.fn(),
            startChunkedTranscription: jest.fn(),
            resumeChunkedTranscription: jest.fn(),
            getResumableJobs: jest.fn(),
            getChunksBaseDir: jest.fn(),
          },
        },
        {
          provide: TranscriptionStoreService,
          useValue: {
            save: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: AUDIO_STORAGE,
          useValue: audioStorage,
        },
      ],
    }).compile();

    service = module.get<TranscriptionService>(TranscriptionService);
    elevenLabsService = module.get(ElevenLabsService);
    chunkedTranscriptionService = module.get(ChunkedTranscriptionService);
    store = module.get(TranscriptionStoreService);
  });

  describe('getAudioFiles', () => {
    it('最終更新日時の降順で音声ファイル一覧を返す', async () => {
      audioStorage.listFiles.mockResolvedValue([
        { fileName: 'old.mp3', sizeBytes: 1000, lastModified: '2024-01-01T00:00:00Z' },
        { fileName: 'new.mp3', sizeBytes: 2000, lastModified: '2024-02-01T00:00:00Z' },
      ]);

      const result = await service.getAudioFiles();

      expect(result[0].fileName).toBe('new.mp3');
      expect(result[1].fileName).toBe('old.mp3');
    });

    it('ファイルが存在しない場合は空配列を返す', async () => {
      audioStorage.listFiles.mockResolvedValue([]);

      const result = await service.getAudioFiles();

      expect(result).toEqual([]);
    });
  });

  describe('getAudioFileUrl', () => {
    it('ファイルが存在する場合は再生URLを返す', async () => {
      audioStorage.exists.mockResolvedValue(true);
      audioStorage.getPlaybackUrl.mockResolvedValue('/audio/test.mp3');

      const result = await service.getAudioFileUrl('test.mp3');

      expect(result).toBe('/audio/test.mp3');
    });

    it('ファイルが存在しない場合はNotFoundExceptionをスロー', async () => {
      audioStorage.exists.mockResolvedValue(false);

      await expect(service.getAudioFileUrl('missing.mp3')).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkAudioFileExists', () => {
    it('ファイルが存在する場合はtrueを返す', async () => {
      audioStorage.exists.mockResolvedValue(true);
      expect(await service.checkAudioFileExists('test.mp3')).toBe(true);
    });

    it('ファイルが存在しない場合はfalseを返す', async () => {
      audioStorage.exists.mockResolvedValue(false);
      expect(await service.checkAudioFileExists('missing.mp3')).toBe(false);
    });
  });

  describe('uploadAudioFile', () => {
    it('音声ファイルを保存する', async () => {
      audioStorage.saveFile.mockResolvedValue(undefined);
      const buffer = Buffer.from('test');

      await service.uploadAudioFile('test.mp3', buffer);

      expect(audioStorage.saveFile).toHaveBeenCalledWith('test.mp3', buffer);
    });
  });

  describe('deleteAllResourcesByFileName', () => {
    it('音声ファイル・ジョブ・文字起こし履歴をすべて削除する', async () => {
      audioStorage.exists.mockResolvedValue(true);
      audioStorage.deleteFile.mockResolvedValue(undefined);
      chunkedTranscriptionService.findAllJobsByFileName.mockResolvedValue([
        { id: 'job-1', status: 'completed', audioFileName: 'test.mp3' } as any,
      ]);
      chunkedTranscriptionService.deleteJob.mockResolvedValue(undefined);
      store.findAll.mockResolvedValue([
        { ...makeTranscription('test-audio', 'test.mp3') },
        { ...makeTranscription('other-audio', 'other.mp3') },
      ]);
      store.delete.mockResolvedValue(undefined);

      await service.deleteAllResourcesByFileName('test.mp3');

      expect(audioStorage.deleteFile).toHaveBeenCalledWith('test.mp3');
      expect(chunkedTranscriptionService.deleteJob).toHaveBeenCalledWith('job-1');
      // test.mp3 に紐づく文字起こし（test-audio）だけ削除
      expect(store.delete).toHaveBeenCalledWith('test-audio');
      expect(store.delete).not.toHaveBeenCalledWith('other-audio');
    });

    it('音声ファイルが存在しない場合はファイル削除をスキップする', async () => {
      audioStorage.exists.mockResolvedValue(false);
      chunkedTranscriptionService.findAllJobsByFileName.mockResolvedValue([]);
      store.findAll.mockResolvedValue([]);

      await service.deleteAllResourcesByFileName('missing.mp3');

      expect(audioStorage.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('transcribe', () => {
    it('ファイルが存在しない場合はNotFoundExceptionをスロー', async () => {
      audioStorage.exists.mockResolvedValue(false);

      await expect(service.transcribe('missing.mp3')).rejects.toThrow(NotFoundException);
    });

    it('10分以下のファイルは一括で文字起こしする', async () => {
      audioStorage.exists.mockResolvedValue(true);
      audioStorage.readFile.mockResolvedValue(Buffer.from('audio'));
      chunkedTranscriptionService.createJob.mockResolvedValue({
        id: 'job-1',
        status: 'transcribing',
        audioFileName: 'test.mp3',
      } as any);
      chunkedTranscriptionService.isJobProcessing.mockReturnValue(false);
      chunkedTranscriptionService.needsChunking.mockResolvedValue({ needs: false });
      chunkedTranscriptionService.deleteJob.mockResolvedValue(undefined);
      elevenLabsService.transcribe.mockResolvedValue({
        words: [
          { text: 'こんにちは', start: 0, end: 1, type: 'word', speaker_id: 'speaker_0', logprob: -0.1 },
        ],
        text: 'こんにちは',
        language_code: 'ja',
      } as any);
      store.save.mockResolvedValue(undefined);

      const result = await service.transcribe('test.mp3');

      expect(result.audioFileName).toBe('test.mp3');
      expect(result.languageCode).toBe('ja');
      expect(chunkedTranscriptionService.deleteJob).toHaveBeenCalledWith('job-1');
    });

    it('完了済みジョブで文字起こし結果がある場合は既存の結果を返す', async () => {
      audioStorage.exists.mockResolvedValue(true);
      audioStorage.readFile.mockResolvedValue(Buffer.from('audio'));
      chunkedTranscriptionService.createJob.mockResolvedValue({
        id: 'job-1',
        status: 'completed',
        transcriptionId: 'test-audio',
        audioFileName: 'test.mp3',
      } as any);
      const existing = makeTranscription();
      store.findById.mockResolvedValue(existing);

      const result = await service.transcribe('test.mp3');

      expect(result).toEqual(existing);
      expect(elevenLabsService.transcribe).not.toHaveBeenCalled();
    });

    it('処理中のジョブに重複リクエストするとエラーをスロー', async () => {
      audioStorage.exists.mockResolvedValue(true);
      audioStorage.readFile.mockResolvedValue(Buffer.from('audio'));
      chunkedTranscriptionService.createJob.mockResolvedValue({
        id: 'job-1',
        status: 'transcribing',
        audioFileName: 'test.mp3',
      } as any);
      chunkedTranscriptionService.isJobProcessing.mockReturnValue(true);

      await expect(service.transcribe('test.mp3')).rejects.toThrow(
        'このファイルは現在文字起こし処理中です',
      );
    });
  });

  describe('getTranscriptions', () => {
    it('createdAtの降順で文字起こし一覧を返す', async () => {
      store.findAll.mockResolvedValue([
        { ...makeTranscription('old', 'old.mp3'), createdAt: '2024-01-01T00:00:00Z' },
        { ...makeTranscription('new', 'new.mp3'), createdAt: '2024-02-01T00:00:00Z' },
      ]);

      const result = await service.getTranscriptions();

      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('old');
      // サマリーのみ（speakers・words・utterancesは含まない）
      expect((result[0] as any).speakers).toBeUndefined();
    });
  });

  describe('getTranscription', () => {
    it('IDで文字起こし結果を取得する', async () => {
      const transcription = makeTranscription();
      store.findById.mockResolvedValue(transcription);

      const result = await service.getTranscription('test-audio');

      expect(result).toEqual(transcription);
    });

    it('存在しないIDはNotFoundExceptionをスロー', async () => {
      store.findById.mockResolvedValue(null);

      await expect(service.getTranscription('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSpeakers', () => {
    it('話者名を更新して発話セグメントにも反映する', async () => {
      const transcription = makeTranscription();
      store.findById.mockResolvedValue(transcription);
      store.save.mockResolvedValue(undefined);

      const result = await service.updateSpeakers('test-audio', [
        { id: 'speaker_0', name: '田中さん' },
      ]);

      expect(result.speakers[0].name).toBe('田中さん');
      // 発話セグメントの話者名も更新されている
      expect(result.utterances[0].speakerName).toBe('田中さん');
      // 更新対象でない話者は変わらない
      expect(result.speakers[1].name).toBe('Bさん');
    });

    it('文字起こしが存在しない場合はNotFoundExceptionをスロー', async () => {
      store.findById.mockResolvedValue(null);

      await expect(
        service.updateSpeakers('missing', [{ id: 'speaker_0', name: '田中さん' }]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResumableJobs / getChunkedJobStatus / findActiveJob', () => {
    it('再開可能ジョブ一覧を取得する', async () => {
      const jobs = [{ id: 'job-1' } as any];
      chunkedTranscriptionService.getResumableJobs.mockResolvedValue(jobs);

      expect(await service.getResumableJobs()).toEqual(jobs);
    });

    it('ジョブの進捗を取得する', async () => {
      const job = { id: 'job-1', status: 'transcribing' } as any;
      chunkedTranscriptionService.getJobStatus.mockResolvedValue(job);

      expect(await service.getChunkedJobStatus('job-1')).toEqual(job);
    });

    it('ファイル名でアクティブジョブを検索する', async () => {
      const job = { id: 'job-1', audioFileName: 'test.mp3' } as any;
      chunkedTranscriptionService.findActiveJobByFileName.mockResolvedValue(job);

      expect(await service.findActiveJob('test.mp3')).toEqual(job);
    });
  });
});
