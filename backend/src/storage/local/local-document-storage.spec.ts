import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocalDocumentStorage } from './local-document-storage';
import { DocumentMetadata } from '../../document/types/document.types';

/** テスト用のメタデータ */
function makeMetadata(id: string): DocumentMetadata {
  return {
    id,
    fileName: `${id}.pdf`,
    sizeBytes: 1024,
    status: 'searchable',
    chunkCount: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

describe('LocalDocumentStorage', () => {
  let storage: LocalDocumentStorage;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'document-storage-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalDocumentStorage,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'DATA_DIR') return tmpDir;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    storage = module.get<LocalDocumentStorage>(LocalDocumentStorage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('saveFile / readFile / deleteFile', () => {
    it('ファイルを保存してIDで読み込める', async () => {
      const buffer = Buffer.from('PDF content');

      await storage.saveFile('doc-1', 'document.pdf', buffer);
      const result = await storage.readFile('doc-1');

      expect(result).toEqual(buffer);
    });

    it('存在しないIDのファイル読み込みはエラーをスロー', async () => {
      await expect(storage.readFile('missing')).rejects.toThrow(
        'ドキュメントファイルが見つかりません',
      );
    });

    it('ファイルを削除する', async () => {
      await storage.saveFile('doc-1', 'document.pdf', Buffer.from('data'));
      await storage.deleteFile('doc-1');

      await expect(storage.readFile('doc-1')).rejects.toThrow();
    });

    it('存在しないファイルの削除は何もしない', async () => {
      await expect(storage.deleteFile('missing')).resolves.not.toThrow();
    });
  });

  describe('saveMetadata / findMetadataById / findAllMetadata / deleteMetadata', () => {
    it('メタデータを保存してIDで取得できる', async () => {
      const metadata = makeMetadata('doc-1');

      await storage.saveMetadata(metadata);
      const found = await storage.findMetadataById('doc-1');

      expect(found).toEqual(metadata);
    });

    it('存在しないIDのメタデータはnullを返す', async () => {
      const found = await storage.findMetadataById('missing');
      expect(found).toBeNull();
    });

    it('全メタデータを取得できる', async () => {
      await storage.saveMetadata(makeMetadata('doc-1'));
      await storage.saveMetadata(makeMetadata('doc-2'));

      const all = await storage.findAllMetadata();

      const ids = all.map((m) => m.id);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-2');
    });

    it('メタデータが存在しない場合は空配列を返す', async () => {
      const all = await storage.findAllMetadata();
      expect(all).toEqual([]);
    });

    it('壊れたJSONファイルはスキップされる', async () => {
      const metadataDir = path.join(tmpDir, 'document-metadata');
      await fs.writeFile(path.join(metadataDir, 'broken.json'), 'not-json', 'utf-8');
      await storage.saveMetadata(makeMetadata('valid-doc'));

      const all = await storage.findAllMetadata();

      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('valid-doc');
    });

    it('メタデータを削除する', async () => {
      await storage.saveMetadata(makeMetadata('doc-1'));
      await storage.deleteMetadata('doc-1');

      const found = await storage.findMetadataById('doc-1');
      expect(found).toBeNull();
    });

    it('存在しないメタデータの削除は何もしない', async () => {
      await expect(storage.deleteMetadata('missing')).resolves.not.toThrow();
    });
  });
});
