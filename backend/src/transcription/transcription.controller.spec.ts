import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';

/** TranscriptionServiceのモック */
const mockTranscriptionService = {
  getAudioFiles: jest.fn(),
  checkAudioFileExists: jest.fn(),
  deleteAllResourcesByFileName: jest.fn(),
  getUploadUrl: jest.fn(),
  uploadAudioFile: jest.fn(),
  getAudioFileUrl: jest.fn(),
  transcribe: jest.fn(),
  findActiveJob: jest.fn(),
  getResumableJobs: jest.fn(),
  isJobProcessing: jest.fn(),
  getJobDetail: jest.fn(),
  deleteJob: jest.fn(),
  resumeTranscription: jest.fn(),
  getTranscriptions: jest.fn(),
  getTranscription: jest.fn(),
  updateSpeakers: jest.fn(),
  getChunksBaseDir: jest.fn(),
};

/** ElevenLabsServiceのモック */
const mockElevenLabsService = {
  checkCredits: jest.fn(),
};

describe('TranscriptionController', () => {
  let controller: TranscriptionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranscriptionController],
      providers: [
        { provide: TranscriptionService, useValue: mockTranscriptionService },
        { provide: ElevenLabsService, useValue: mockElevenLabsService },
      ],
    }).compile();

    controller = module.get<TranscriptionController>(TranscriptionController);
    jest.clearAllMocks();
  });

  describe('checkCredits', () => {
    it('クレジット情報を返す', async () => {
      const creditInfo = {
        characterCount: 500,
        characterLimit: 10000,
        remainingCredits: 9500,
        nextResetDate: '2026-07-01T00:00:00.000Z',
      };
      mockElevenLabsService.checkCredits.mockResolvedValueOnce(creditInfo);

      const result = await controller.checkCredits();

      expect(result).toEqual({ creditInfo });
    });

    it('APIキー未設定時は422エラーを返す', async () => {
      mockElevenLabsService.checkCredits.mockRejectedValue(
        new Error('ELEVENLABS_API_KEY が設定されていません'),
      );

      await expect(controller.checkCredits()).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    });

    it('その他のエラーは502を返す', async () => {
      mockElevenLabsService.checkCredits.mockRejectedValueOnce(
        new Error('connection error'),
      );

      await expect(controller.checkCredits()).rejects.toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
      });
    });
  });

  describe('getAudioFiles', () => {
    it('音声ファイル一覧を返す', async () => {
      const files = [
        { fileName: 'test.mp3', sizeBytes: 1000, lastModified: '2026-01-01' },
      ];
      mockTranscriptionService.getAudioFiles.mockResolvedValueOnce(files);

      const result = await controller.getAudioFiles();

      expect(result).toEqual({ files });
    });
  });

  describe('checkAudioFileExists', () => {
    it('ファイルが存在する場合はtrueを返す', async () => {
      mockTranscriptionService.checkAudioFileExists.mockResolvedValueOnce(true);

      const result = await controller.checkAudioFileExists('test.mp3');

      expect(result).toEqual({ exists: true });
    });

    it('ファイルが存在しない場合はfalseを返す', async () => {
      mockTranscriptionService.checkAudioFileExists.mockResolvedValueOnce(false);

      const result = await controller.checkAudioFileExists('missing.mp3');

      expect(result).toEqual({ exists: false });
    });
  });

  describe('uploadAudioFile', () => {
    it('日本語ファイル名をUTF-8で正しく保存する', async () => {
      // Multerはlatin1でデコードするため、latin1でエンコードされた日本語ファイル名をシミュレート
      const originalName = Buffer.from('テスト音声.mp3').toString('latin1');
      const file = {
        originalname: originalName,
        buffer: Buffer.from('audio data'),
        size: 10,
      } as Express.Multer.File;
      mockTranscriptionService.uploadAudioFile.mockResolvedValueOnce(undefined);

      const result = await controller.uploadAudioFile(file);

      expect(result.fileName).toBe('テスト音声.mp3');
      expect(mockTranscriptionService.uploadAudioFile).toHaveBeenCalledWith(
        'テスト音声.mp3',
        file.buffer,
      );
    });

    it('ファイルが指定されていない場合は400エラーを返す', async () => {
      await expect(
        controller.uploadAudioFile(undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('transcribe', () => {
    it('文字起こし結果を返す', async () => {
      const transcription = { id: 'tr-001', text: 'こんにちは' };
      mockTranscriptionService.transcribe.mockResolvedValueOnce(transcription);

      const result = await controller.transcribe({ fileName: 'test.mp3' });

      expect(result).toEqual({ transcription });
    });

    it('QuotaExceededErrorは402を返す', async () => {
      const error = new Error('利用枠の上限に達しました');
      error.name = 'QuotaExceededError';
      mockTranscriptionService.transcribe.mockRejectedValueOnce(error);

      await expect(
        controller.transcribe({ fileName: 'test.mp3' }),
      ).rejects.toMatchObject({ status: HttpStatus.PAYMENT_REQUIRED });
    });

    it('TranscriptionTimeoutErrorは408を返す', async () => {
      const error = new Error('タイムアウト');
      error.name = 'TranscriptionTimeoutError';
      mockTranscriptionService.transcribe.mockRejectedValueOnce(error);

      await expect(
        controller.transcribe({ fileName: 'test.mp3' }),
      ).rejects.toMatchObject({ status: HttpStatus.REQUEST_TIMEOUT });
    });

    it('APIキー未設定エラーは422を返す', async () => {
      mockTranscriptionService.transcribe.mockRejectedValueOnce(
        new Error('ELEVENLABS_API_KEY が設定されていません'),
      );

      await expect(
        controller.transcribe({ fileName: 'test.mp3' }),
      ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    });

    it('ffmpeg未インストールエラーは422を返す', async () => {
      mockTranscriptionService.transcribe.mockRejectedValueOnce(
        new Error('ffprobeが見つかりません'),
      );

      await expect(
        controller.transcribe({ fileName: 'test.mp3' }),
      ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    });

    it('その他のエラーは500を返す', async () => {
      mockTranscriptionService.transcribe.mockRejectedValueOnce(
        new Error('unexpected error'),
      );

      await expect(
        controller.transcribe({ fileName: 'test.mp3' }),
      ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    });
  });

  describe('getTranscriptions', () => {
    it('文字起こし一覧を返す', async () => {
      const transcriptions = [{ id: 'tr-001' }, { id: 'tr-002' }];
      mockTranscriptionService.getTranscriptions.mockResolvedValueOnce(transcriptions);

      const result = await controller.getTranscriptions();

      expect(result).toEqual({ transcriptions });
    });
  });

  describe('getTranscription', () => {
    it('指定したIDの文字起こし結果を返す', async () => {
      const transcription = { id: 'tr-001', text: 'テスト' };
      mockTranscriptionService.getTranscription.mockResolvedValueOnce(transcription);

      const result = await controller.getTranscription('tr-001');

      expect(result).toEqual({ transcription });
    });
  });

  describe('getResumableJobs', () => {
    it('ジョブ一覧にisProcessingを付与して返す', async () => {
      const jobs = [{ id: 'job-001' }, { id: 'job-002' }];
      mockTranscriptionService.getResumableJobs.mockResolvedValueOnce(jobs);
      mockTranscriptionService.isJobProcessing.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await controller.getResumableJobs();

      expect(result.jobs).toHaveLength(2);
      expect(result.jobs[0].isProcessing).toBe(true);
      expect(result.jobs[1].isProcessing).toBe(false);
    });
  });

  describe('deleteJob', () => {
    it('存在するジョブを削除できる', async () => {
      mockTranscriptionService.getJobDetail.mockResolvedValueOnce({ id: 'job-001' });
      mockTranscriptionService.deleteJob.mockResolvedValueOnce(undefined);

      const result = await controller.deleteJob('job-001');

      expect(result).toEqual({ success: true });
    });

    it('存在しないジョブは404を返す', async () => {
      mockTranscriptionService.getJobDetail.mockResolvedValueOnce(null);

      await expect(controller.deleteJob('nonexistent')).rejects.toThrow(
        'ジョブが見つかりません',
      );
    });
  });

  describe('updateSpeakers', () => {
    it('話者名を更新して返す', async () => {
      const updated = { id: 'tr-001', speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }] };
      mockTranscriptionService.updateSpeakers.mockResolvedValueOnce(updated);

      const result = await controller.updateSpeakers('tr-001', {
        speakers: [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }],
      });

      expect(result).toEqual({ transcription: updated });
    });
  });
});
