import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { EmbeddingService } from './embedding.service';
import { VectorSearchService } from './vector-search.service';
import { DOCUMENT_STORAGE } from '../storage/interfaces/document-storage.interface';
import { DocumentMetadata } from './types/document.types';

/** テスト用のDocumentMetadataを生成するヘルパー */
function makeMetadata(overrides?: Partial<DocumentMetadata>): DocumentMetadata {
  return {
    id: 'doc-001',
    fileName: 'test.pdf',
    sizeBytes: 1024,
    status: 'processing',
    chunkCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const mockStorage = {
  saveFile: jest.fn(),
  readFile: jest.fn(),
  deleteFile: jest.fn(),
  saveMetadata: jest.fn(),
  findMetadataById: jest.fn(),
  findAllMetadata: jest.fn(),
  deleteMetadata: jest.fn(),
};

const mockEmbeddingService = {
  generateEmbeddings: jest.fn(),
};

const mockVectorSearchService = {
  putVectors: jest.fn(),
  deleteByDocumentId: jest.fn(),
};

describe('DocumentService', () => {
  let service: DocumentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: DOCUMENT_STORAGE, useValue: mockStorage },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: VectorSearchService, useValue: mockVectorSearchService },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('ファイルを保存してmetadataを返す', async () => {
      mockStorage.saveFile.mockResolvedValueOnce(undefined);
      mockStorage.saveMetadata.mockResolvedValueOnce(undefined);
      // processDocumentは非同期で実行されるためモックしておく
      mockStorage.findMetadataById.mockResolvedValue(null);

      const result = await service.upload('test.pdf', Buffer.from('pdf'), 1024);

      expect(result.fileName).toBe('test.pdf');
      expect(result.sizeBytes).toBe(1024);
      expect(result.status).toBe('processing');
      expect(result.id).toBeTruthy();
      expect(mockStorage.saveFile).toHaveBeenCalledTimes(1);
      expect(mockStorage.saveMetadata).toHaveBeenCalledTimes(1);
    });
  });

  describe('listDocuments', () => {
    it('全ドキュメントの一覧を返す', async () => {
      const docs = [makeMetadata(), makeMetadata({ id: 'doc-002', fileName: 'other.pdf' })];
      mockStorage.findAllMetadata.mockResolvedValueOnce(docs);

      const result = await service.listDocuments();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('doc-001');
    });
  });

  describe('getStatus', () => {
    it('存在するドキュメントのステータスを返す', async () => {
      const metadata = makeMetadata({ status: 'searchable' });
      mockStorage.findMetadataById.mockResolvedValueOnce(metadata);

      const result = await service.getStatus('doc-001');

      expect(result.status).toBe('searchable');
    });

    it('存在しないIDはNotFoundExceptionをスローする', async () => {
      mockStorage.findMetadataById.mockResolvedValueOnce(null);

      await expect(service.getStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteDocument', () => {
    it('ドキュメントとベクトルと関連メタデータを削除する', async () => {
      const metadata = makeMetadata();
      mockStorage.findMetadataById.mockResolvedValueOnce(metadata);
      mockVectorSearchService.deleteByDocumentId.mockResolvedValueOnce(undefined);
      mockStorage.deleteFile.mockResolvedValueOnce(undefined);
      mockStorage.deleteMetadata.mockResolvedValueOnce(undefined);

      await service.deleteDocument('doc-001');

      expect(mockVectorSearchService.deleteByDocumentId).toHaveBeenCalledWith('doc-001');
      expect(mockStorage.deleteFile).toHaveBeenCalledWith('doc-001');
      expect(mockStorage.deleteMetadata).toHaveBeenCalledWith('doc-001');
    });

    it('存在しないIDはNotFoundExceptionをスローする', async () => {
      mockStorage.findMetadataById.mockResolvedValueOnce(null);

      await expect(service.deleteDocument('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ベクトル削除が失敗してもファイル削除は続行する', async () => {
      const metadata = makeMetadata();
      mockStorage.findMetadataById.mockResolvedValueOnce(metadata);
      mockVectorSearchService.deleteByDocumentId.mockRejectedValueOnce(
        new Error('ベクトルDB接続エラー'),
      );
      mockStorage.deleteFile.mockResolvedValueOnce(undefined);
      mockStorage.deleteMetadata.mockResolvedValueOnce(undefined);

      await expect(service.deleteDocument('doc-001')).resolves.not.toThrow();
      expect(mockStorage.deleteFile).toHaveBeenCalledWith('doc-001');
      expect(mockStorage.deleteMetadata).toHaveBeenCalledWith('doc-001');
    });
  });
});
