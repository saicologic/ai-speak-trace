import { Controller, Get, Param, Post } from '@nestjs/common';
import { GinzaEnvService } from './ginza-env.service';
import { GinzaKeywordsService } from './ginza-keywords.service';

/** GiNZA のキーワード抽出（ベータ機能） */
@Controller('ginza')
export class GinzaController {
  constructor(
    private readonly env: GinzaEnvService,
    private readonly keywords: GinzaKeywordsService,
  ) {}

  /** GiNZA の準備の状態: GET /api/ginza/status */
  @Get('status')
  async getStatus() {
    return { status: await this.env.getStatus() };
  }

  /** GiNZA のインストールを始める（終わるのを待たない）: POST /api/ginza/install */
  @Post('install')
  async install() {
    this.keywords.assertEnabled();
    this.env.startInstall();
    return { status: await this.env.getStatus() };
  }

  /** 会話のキーワード（全体と話者ごと）: GET /api/ginza/transcriptions/:id/keywords */
  @Get('transcriptions/:id/keywords')
  getKeywords(@Param('id') id: string) {
    return this.keywords.getKeywords(id);
  }
}
