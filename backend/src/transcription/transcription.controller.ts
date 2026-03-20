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
  HttpException,
  HttpStatus,
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
    console.log('[upload] リクエスト受信', file ? `size=${file.size}, name=${file.originalname}` : 'file=null');
    if (!file) {
      throw new BadRequestException('ファイルが指定されていません');
    }
    // Multerはファイル名をlatin1でデコードするため、日本語ファイル名が文字化けする
    // latin1 → utf8に再変換して正しいファイル名を復元する
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    console.log('[upload] 保存開始:', fileName);
    await this.transcriptionService.uploadAudioFile(fileName, file.buffer);
    console.log('[upload] 保存完了:', fileName);
    return { fileName };
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
    console.log('[transcribe] リクエスト受信:', dto.fileName);
    try {
      const transcription = await this.transcriptionService.transcribe(
        dto.fileName,
      );
      console.log('[transcribe] 完了:', dto.fileName);
      return { transcription };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      const errName = error instanceof Error ? error.name : 'Unknown';
      console.error('[transcribe] エラー詳細:', {
        name: errName,
        message: errMsg,
        stack: errStack,
        fileName: dto.fileName,
      });
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new HttpException(
          { code: 'QUOTA_EXCEEDED', message: error.message },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      // APIキー未設定エラー
      if (
        error instanceof Error &&
        error.message.includes('ELEVENLABS_API_KEY が設定されていません')
      ) {
        throw new HttpException(
          {
            code: 'API_KEY_MISSING',
            message:
              'ElevenLabs APIキーが設定されていません。設定画面からAPIキーを設定してください。',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }

  /** 文字起こし一覧取得: GET /api/transcriptions */
  @Get('transcriptions')
  async getTranscriptions() {
    console.log('[transcriptions] 一覧取得リクエスト受信');
    try {
      const transcriptions =
        await this.transcriptionService.getTranscriptions();
      console.log('[transcriptions] 一覧取得完了:', transcriptions.length, '件');
      return { transcriptions };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      console.error('[transcriptions] 一覧取得エラー:', { message: errMsg, stack: errStack });
      throw error;
    }
  }

  /** 文字起こし結果取得: GET /api/transcriptions/:id */
  @Get('transcriptions/:id')
  async getTranscription(@Param('id') id: string) {
    console.log('[transcriptions] 個別取得リクエスト受信: id=', id);
    try {
      const transcription =
        await this.transcriptionService.getTranscription(id);
      console.log('[transcriptions] 個別取得完了: id=', id);
      return { transcription };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      console.error('[transcriptions] 個別取得エラー:', { id, message: errMsg, stack: errStack });
      throw error;
    }
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
