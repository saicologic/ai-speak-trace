import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { PodcastService } from './podcast.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { AUDIO_STORAGE } from '../storage/interfaces/audio-storage.interface';
import type { AudioStorage } from '../storage/interfaces/audio-storage.interface';

/** 拡張子からContent-Typeを判定 */
const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

@Controller()
export class PodcastController {
  constructor(
    private readonly podcastService: PodcastService,
    private readonly transcriptionService: TranscriptionService,
    @Inject(AUDIO_STORAGE) private readonly audioStorage: AudioStorage,
  ) {}

  /** Podcastキャッシュファイル一覧取得: GET /api/podcast-files */
  @Get('podcast-files')
  async listPodcastFiles() {
    const exists = this.podcastService.exists();
    const files = await this.podcastService.listFiles();
    // デバッグ: 実際に参照しているパスを返す
    const debugPath = this.podcastService.getCacheDir();
    return { exists, files, debugPath };
  }

  /** Podcastファイルをストリーミング配信: GET /api/podcast-files/:fileName/stream */
  @Get('podcast-files/:fileName/stream')
  async streamPodcastFile(
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const buffer = await this.podcastService.readFile(fileName);
    const ext = path.extname(fileName).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.set({ 'Content-Type': contentType, 'Content-Length': buffer.length });
    res.send(buffer);
  }

  /** Podcastファイルをコピーして文字起こし: POST /api/podcast-transcribe */
  @Post('podcast-transcribe')
  async transcribePodcastFile(@Body() body: { fileName: string }) {
    if (!body.fileName) {
      throw new BadRequestException('ファイル名が指定されていません');
    }

    try {
      // 1. Podcastキャッシュからファイルを読み込み
      const buffer = await this.podcastService.readFile(body.fileName);

      // 2. outputs/ ディレクトリにコピー保存
      await this.audioStorage.saveFile(body.fileName, buffer);

      // 3. 既存の文字起こしフローで処理
      const transcription =
        await this.transcriptionService.transcribe(body.fileName);
      return { transcription };
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new HttpException(
          { code: 'QUOTA_EXCEEDED', message: error.message },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw error;
    }
  }
}
