import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TranscriptionService } from './transcription.service';
import { TranscribeRequestDto } from './dto/transcribe-request.dto';
import { UpdateSpeakersDto } from './dto/update-speakers.dto';

/** 文字起こしAPIコントローラー */
@Controller()
export class TranscriptionController {
  constructor(
    private readonly transcriptionService: TranscriptionService,
  ) {}

  /** 音声ファイル一覧取得: GET /api/audio-files */
  @Get('audio-files')
  async getAudioFiles() {
    const files = await this.transcriptionService.getAudioFiles();
    return { files };
  }

  /** アップロード用署名付きURL取得: POST /api/audio-files/upload-url */
  @Post('audio-files/upload-url')
  async getUploadUrl(@Body() body: { fileName: string }) {
    if (!body.fileName) {
      throw new BadRequestException('ファイル名が指定されていません');
    }
    const url = await this.transcriptionService.getUploadUrl(body.fileName);
    return { url };
  }

  /** 音声ファイルアップロード: POST /api/audio-files */
  @Post('audio-files')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAudioFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('ファイルが指定されていません');
    }
    await this.transcriptionService.uploadAudioFile(
      file.originalname,
      file.buffer,
    );
    return { fileName: file.originalname };
  }

  /** 音声ファイル再生URL取得: GET /api/audio-files/:fileName/url */
  @Get('audio-files/:fileName/url')
  async getAudioFileUrl(@Param('fileName') fileName: string) {
    const url = await this.transcriptionService.getAudioFileUrl(fileName);
    return { url };
  }

  /** 文字起こし実行: POST /api/transcribe */
  @Post('transcribe')
  async transcribe(@Body() dto: TranscribeRequestDto) {
    const transcription = await this.transcriptionService.transcribe(
      dto.fileName,
    );
    return { transcription };
  }

  /** 文字起こし一覧取得: GET /api/transcriptions */
  @Get('transcriptions')
  async getTranscriptions() {
    const transcriptions =
      await this.transcriptionService.getTranscriptions();
    return { transcriptions };
  }

  /** 文字起こし結果取得: GET /api/transcriptions/:id */
  @Get('transcriptions/:id')
  async getTranscription(@Param('id') id: string) {
    const transcription =
      await this.transcriptionService.getTranscription(id);
    return { transcription };
  }

  /** 話者名更新: PATCH /api/transcriptions/:id/speakers */
  @Patch('transcriptions/:id/speakers')
  async updateSpeakers(
    @Param('id') id: string,
    @Body() dto: UpdateSpeakersDto,
  ) {
    const transcription = await this.transcriptionService.updateSpeakers(
      id,
      dto.speakers,
    );
    return { transcription };
  }
}
