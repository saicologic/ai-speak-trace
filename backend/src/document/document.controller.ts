import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';

/** PDFドキュメント管理のAPIコントローラー */
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /** PDF一覧取得: GET /api/documents */
  @Get()
  async listDocuments() {
    const documents = await this.documentService.listDocuments();
    return { documents };
  }

  /** PDFアップロード: POST /api/documents */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('ファイルが指定されていません');
    }

    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('PDFファイルのみアップロードできます');
    }

    const metadata = await this.documentService.upload(
      file.originalname,
      file.buffer,
      file.size,
    );
    return { document: metadata };
  }

  /** PDF処理ステータス取得: GET /api/documents/:id/status */
  @Get(':id/status')
  async getDocumentStatus(@Param('id') id: string) {
    const metadata = await this.documentService.getStatus(id);
    return { document: metadata };
  }

  /** PDF削除: DELETE /api/documents/:id */
  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    await this.documentService.deleteDocument(id);
    return { message: '削除しました' };
  }
}
