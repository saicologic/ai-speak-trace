import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { DeepSearchService } from './deep-search.service';
import { DeepSearchDto, DeepSearchAnalyzeDto } from './dto/deep-search.dto';

/** ディープサーチAPIコントローラー */
@Controller('deep-search')
export class DeepSearchController {
  constructor(private readonly deepSearchService: DeepSearchService) {}

  /** ディープサーチ実行: POST /api/deep-search */
  @Post()
  async search(@Body() dto: DeepSearchDto) {
    return this.deepSearchService.search(dto);
  }

  /** 検索結果のClaude分析: POST /api/deep-search/analyze */
  @Post('analyze')
  async analyze(@Body() dto: DeepSearchAnalyzeDto) {
    return this.deepSearchService.analyzeResults(dto);
  }

  /** ディープサーチログ一覧: GET /api/deep-search/logs */
  @Get('logs')
  async findLogs() {
    const logs = await this.deepSearchService.findLogs();
    return { logs };
  }

  /** ディープサーチログ詳細: GET /api/deep-search/logs/:id */
  @Get('logs/:id')
  async findLog(@Param('id') id: string) {
    const log = await this.deepSearchService.findLogById(id);
    if (!log) {
      throw new NotFoundException('ディープサーチログが見つかりません');
    }
    return { log };
  }
}
