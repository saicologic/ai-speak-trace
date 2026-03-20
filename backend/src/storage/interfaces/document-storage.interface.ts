import { DocumentMetadata } from '../../document/types/document.types';

/** ドキュメントファイルストレージのインターフェース */
export interface DocumentStorage {
  /** PDFファイルを保存 */
  saveFile(id: string, fileName: string, buffer: Buffer): Promise<void>;

  /** PDFファイルを読み込み */
  readFile(id: string): Promise<Buffer>;

  /** PDFファイルを削除 */
  deleteFile(id: string): Promise<void>;

  /** メタデータを保存 */
  saveMetadata(metadata: DocumentMetadata): Promise<void>;

  /** メタデータを取得 */
  findMetadataById(id: string): Promise<DocumentMetadata | null>;

  /** 全メタデータを取得 */
  findAllMetadata(): Promise<DocumentMetadata[]>;

  /** メタデータを削除 */
  deleteMetadata(id: string): Promise<void>;
}

/** DI用のインジェクショントークン */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');
