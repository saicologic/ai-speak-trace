import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetIndexCommand } from '@aws-sdk/client-s3vectors';
import { VectorSearchService } from './vector-search.service';

describe('VectorSearchService', () => {
  let warnSpy: jest.SpyInstance;

  /** 指定した環境変数でサービスを生成し、S3 Vectorsクライアントの送信をモックする */
  const createService = (
    env: Record<string, string>,
    send: jest.Mock,
  ): VectorSearchService => {
    const configService = {
      get: jest.fn(
        (key: string, defaultValue?: string) => env[key] ?? defaultValue,
      ),
    } as unknown as ConfigService;
    const service = new VectorSearchService(configService);
    (service as unknown as { client: { send: jest.Mock } }).client = { send };
    return service;
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('verifyDistanceMetric', () => {
    const env = { S3_VECTORS_BUCKET: 'bucket', S3_VECTORS_INDEX: 'documents' };

    it('距離指標がcosineの場合は警告しない', async () => {
      const send = jest
        .fn()
        .mockResolvedValue({ index: { distanceMetric: 'cosine' } });
      const service = createService(env, send);

      await service.verifyDistanceMetric();

      expect(send).toHaveBeenCalledWith(expect.any(GetIndexCommand));
      const [command] = send.mock.calls[0] as [GetIndexCommand];
      expect(command.input).toEqual({
        vectorBucketName: 'bucket',
        indexName: 'documents',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('距離指標がcosine以外の場合は警告する', async () => {
      const send = jest
        .fn()
        .mockResolvedValue({ index: { distanceMetric: 'euclidean' } });
      const service = createService(env, send);

      await service.verifyDistanceMetric();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('euclidean'),
      );
    });

    it('GetIndexが失敗しても例外を投げずに警告する', async () => {
      const send = jest.fn().mockRejectedValue(new Error('AccessDenied'));
      const service = createService(env, send);

      await expect(service.verifyDistanceMetric()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('AccessDenied'),
      );
    });

    it('S3_VECTORS_BUCKETが未設定の場合は確認しない', async () => {
      const send = jest.fn();
      const service = createService({}, send);

      await service.verifyDistanceMetric();

      expect(send).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
