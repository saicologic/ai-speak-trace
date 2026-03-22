import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { existsSync, createReadStream } from 'fs';
import { FileInterceptor } from '@nestjs/platform-express';
import { TranscriptionService } from './transcription.service';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscribeRequestDto } from './dto/transcribe-request.dto';
import { UpdateSpeakersDto } from './dto/update-speakers.dto';

/** 文字起こしAPIコントローラー */
@Controller()
export class TranscriptionController {
  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly elevenLabsService: ElevenLabsService,
  ) {}

  /** クレジット残量確認: GET /api/credits/check */
  @Get('credits/check')
  async checkCredits() {
    try {
      const creditInfo = await this.elevenLabsService.checkCredits();
      return { creditInfo };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[credits/check] エラー:', errMsg);
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
      throw new HttpException(
        { code: 'CREDIT_CHECK_FAILED', message: errMsg },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

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
      // タイムアウトエラー
      if (error instanceof Error && error.name === 'TranscriptionTimeoutError') {
        throw new HttpException(
          { code: 'TRANSCRIPTION_TIMEOUT', message: error.message },
          HttpStatus.REQUEST_TIMEOUT,
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
      // ffmpeg未インストールエラー
      if (
        error instanceof Error &&
        (error.message.includes('ffprobeが見つかりません') ||
          error.message.includes('ffmpegがインストールされていません'))
      ) {
        throw new HttpException(
          {
            code: 'FFMPEG_MISSING',
            message:
              'ffmpegがインストールされていません。ターミナルで以下のコマンドを実行してください:\nbrew install ffmpeg',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // その他のエラー: エラーメッセージをクライアントに返す
      throw new HttpException(
        {
          code: 'TRANSCRIPTION_ERROR',
          message: errMsg,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** 進行中のチャンクジョブ状態取得: GET /api/transcribe/jobs/active?fileName=xxx */
  @Get('transcribe/jobs/active')
  async getActiveJob(@Query('fileName') fileName: string) {
    if (!fileName) {
      throw new BadRequestException('fileNameが指定されていません');
    }
    const job = await this.transcriptionService.findActiveJob(fileName);
    return { job };
  }

  /** 再開可能なジョブ一覧取得: GET /api/transcribe/jobs */
  @Get('transcribe/jobs')
  async getResumableJobs() {
    const jobs = await this.transcriptionService.getResumableJobs();
    return { jobs };
  }

  /** ジョブ詳細取得: GET /api/transcribe/jobs/:jobId */
  @Get('transcribe/jobs/:jobId')
  async getJobDetail(@Param('jobId') jobId: string) {
    const job = await this.transcriptionService.getJobDetail(jobId);
    if (!job) {
      throw new NotFoundException(`ジョブが見つかりません: ${jobId}`);
    }
    return { job };
  }

  /** チャンク音声配信: GET /api/transcribe/jobs/:jobId/chunks/:chunkIndex/audio */
  @Get('transcribe/jobs/:jobId/chunks/:chunkIndex/audio')
  async getChunkAudio(
    @Param('jobId') jobId: string,
    @Param('chunkIndex') chunkIndex: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const job = await this.transcriptionService.getJobDetail(jobId);
    if (!job) {
      throw new NotFoundException(`ジョブが見つかりません: ${jobId}`);
    }

    const idx = parseInt(chunkIndex, 10);
    const ext = path.extname(job.audioFileName) || '.m4a';
    const chunkFileName = `chunk_${String(idx).padStart(3, '0')}${ext}`;
    const chunksBaseDir = this.transcriptionService.getChunksBaseDir();
    const chunkPath = path.join(chunksBaseDir, jobId, chunkFileName);

    if (!existsSync(chunkPath)) {
      throw new NotFoundException(
        `チャンク音声ファイルが見つかりません: ${chunkFileName}`,
      );
    }

    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
    };
    res.set('Content-Type', mimeTypes[ext] || 'audio/mpeg');

    const fileStream = createReadStream(chunkPath);
    return new StreamableFile(fileStream);
  }

  /** ジョブ削除: DELETE /api/transcribe/jobs/:jobId */
  @Delete('transcribe/jobs/:jobId')
  async deleteJob(@Param('jobId') jobId: string) {
    const job = await this.transcriptionService.getJobDetail(jobId);
    if (!job) {
      throw new NotFoundException(`ジョブが見つかりません: ${jobId}`);
    }
    await this.transcriptionService.deleteJob(jobId);
    console.log('[transcribe/jobs] ジョブ削除完了:', jobId);
    return { success: true };
  }

  /** チャンクジョブの再開: POST /api/transcribe/resume */
  @Post('transcribe/resume')
  async resumeTranscription(@Body() body: { jobId: string }) {
    if (!body.jobId) {
      throw new BadRequestException('jobIdが指定されていません');
    }
    console.log('[transcribe/resume] リクエスト受信:', body.jobId);
    try {
      const transcription = await this.transcriptionService.resumeTranscription(
        body.jobId,
      );
      console.log('[transcribe/resume] 完了:', body.jobId);
      return { transcription };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errName = error instanceof Error ? error.name : 'Unknown';
      console.error('[transcribe/resume] エラー:', { name: errName, message: errMsg });
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new HttpException(
          { code: 'QUOTA_EXCEEDED', message: error.message },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      if (error instanceof Error && error.name === 'TranscriptionTimeoutError') {
        throw new HttpException(
          { code: 'TRANSCRIPTION_TIMEOUT', message: error.message },
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      // その他のエラー: エラーメッセージをクライアントに返す
      throw new HttpException(
        {
          code: 'TRANSCRIPTION_ERROR',
          message: errMsg,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
