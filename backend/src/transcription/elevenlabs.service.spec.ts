import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { ElevenLabsService } from './elevenlabs.service';
import { ElevenLabsResponse } from './types/elevenlabs.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** テスト用の最小限のElevenLabsレスポンスを生成 */
function makeElResponse(overrides?: Partial<ElevenLabsResponse>): ElevenLabsResponse {
  return {
    language_code: 'ja',
    language_probability: 0.99,
    text: 'こんにちは',
    transcription_id: 'test-id-001',
    words: [
      {
        text: 'こんにちは',
        start: 0,
        end: 1.0,
        type: 'word',
        speaker_id: 'speaker_0',
        logprob: -0.1,
      },
    ],
    ...overrides,
  };
}

describe('ElevenLabsService', () => {
  let service: ElevenLabsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ElevenLabsService],
    }).compile();

    service = module.get<ElevenLabsService>(ElevenLabsService);
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ELEVENLABS_API_KEY;
  });

  describe('transcribe', () => {
    it('正常なAPIレスポンスをパースして返す', async () => {
      const response = makeElResponse();
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: response });

      const result = await service.transcribe(Buffer.from('audio'), 'test.mp3');

      expect(result.language_code).toBe('ja');
      expect(result.words).toHaveLength(1);
      expect(result.transcription_id).toBe('test-id-001');
    });

    it('APIキーが未設定の場合はエラーをスローする', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toThrow('ELEVENLABS_API_KEY が設定されていません');
    });

    it('APIキーが"your_api_key_here"の場合はエラーをスローする', async () => {
      process.env.ELEVENLABS_API_KEY = 'your_api_key_here';

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toThrow('ELEVENLABS_API_KEY が設定されていません');
    });

    it('401レスポンスでAPIキー無効エラーをスローする', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 401,
        data: { detail: 'Unauthorized' },
      });

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toThrow('ElevenLabs APIキーが無効です');
    });

    it('429レスポンスでレート制限エラーをスローする', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 429,
        data: { detail: 'Rate limit exceeded' },
      });

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toThrow('レート制限');
    });

    it('クォータ超過（401 + quota_exceeded）でQuotaExceededErrorをスローする', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 401,
        data: {
          detail: {
            status: 'quota_exceeded',
            message:
              'Your quota of 100000 characters has been reached. You have 0 credits remaining. 5000 credits are required.',
          },
        },
      });

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    });

    it('タイムアウト（ECONNABORTED）でTranscriptionTimeoutErrorをスローする', async () => {
      const timeoutError = new Error('timeout');
      (timeoutError as NodeJS.ErrnoException).code = 'ECONNABORTED';
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockedAxios.post.mockRejectedValueOnce(timeoutError);

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toMatchObject({ name: 'TranscriptionTimeoutError' });
    });

    it('ネットワークエラーで接続失敗エラーをスローする', async () => {
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(false);
      mockedAxios.post.mockRejectedValueOnce(new Error('Network Error'));

      await expect(
        service.transcribe(Buffer.from('audio'), 'test.mp3'),
      ).rejects.toThrow('ElevenLabs APIへの接続に失敗しました');
    });
  });

  describe('checkCredits', () => {
    it('正常なサブスクリプション情報を返す', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          character_count: 1000,
          character_limit: 10000,
          next_character_count_reset_unix: 1700000000,
        },
      });

      const result = await service.checkCredits();

      expect(result.characterCount).toBe(1000);
      expect(result.characterLimit).toBe(10000);
      expect(result.remainingCredits).toBe(9000);
      expect(result.nextResetDate).toBeTruthy();
    });

    it('APIキーが未設定の場合はエラーをスローする', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(service.checkCredits()).rejects.toThrow(
        'ELEVENLABS_API_KEY が設定されていません',
      );
    });

    it('401レスポンスでAPIキー無効エラーをスローする', async () => {
      mockedAxios.get.mockResolvedValueOnce({ status: 401, data: {} });

      await expect(service.checkCredits()).rejects.toThrow(
        'ElevenLabs APIキーが無効です',
      );
    });

    it('レスポンスの値がundefinedの場合は0をデフォルト値として使用する', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const result = await service.checkCredits();

      expect(result.characterCount).toBe(0);
      expect(result.characterLimit).toBe(0);
      expect(result.remainingCredits).toBe(0);
      expect(result.nextResetDate).toBe('');
    });
  });

  describe('getTranscriptionStatus', () => {
    it('200レスポンスでcompletedを返す', async () => {
      const data = makeElResponse();
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data });

      const result = await service.getTranscriptionStatus('test-id-001');

      expect(result.status).toBe('completed');
      expect(result.data).toEqual(data);
    });

    it('404レスポンスでerrorを返す', async () => {
      mockedAxios.get.mockResolvedValueOnce({ status: 404, data: {} });

      const result = await service.getTranscriptionStatus('unknown-id');

      expect(result.status).toBe('error');
      expect(result.error_message).toContain('見つかりません');
    });

    it('401レスポンスでerrorを返す', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 401,
        data: 'Unauthorized',
      });

      const result = await service.getTranscriptionStatus('test-id-001');

      expect(result.status).toBe('error');
      expect(result.error_message).toContain('認証エラー');
    });

    it('APIキーが未設定の場合はエラーをスローする', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(
        service.getTranscriptionStatus('test-id-001'),
      ).rejects.toThrow('ELEVENLABS_API_KEY が設定されていません');
    });

    it('ネットワークエラー時はerrorを返す', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('connection refused'));

      const result = await service.getTranscriptionStatus('test-id-001');

      expect(result.status).toBe('error');
      expect(result.error_message).toBe('connection refused');
    });
  });
});
