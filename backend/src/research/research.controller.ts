import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ResearchService } from './research.service';

/** ディープサーチ（調査）のAPI */
@Controller('research')
export class ResearchController {
  constructor(private readonly researchService: ResearchService) {}

  /** 調査一覧: GET /api/research */
  @Get()
  async findAll() {
    return { jobs: await this.researchService.findAll() };
  }

  /** 調査の状態と結果: GET /api/research/:id */
  @Get(':id')
  async findById(@Param('id') id: string) {
    return { job: await this.researchService.findById(id) };
  }

  /** 調査の開始（①会話の読み込み・②提案）: POST /api/research */
  @Post()
  async start(
    @Body()
    body: {
      transcriptionIds: string[];
      frequentWords?: { word: string; count: number }[];
    },
  ) {
    return {
      job: await this.researchService.start(
        body.transcriptionIds,
        body.frequentWords,
      ),
    };
  }

  /** キーワードと公式サイトの確定（③Web調査・④統合分析・⑤評価）: POST /api/research/:id/confirm */
  @Post(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: { keywords: string[]; domains: string[] },
  ) {
    return {
      job: await this.researchService.confirm(
        id,
        body.keywords ?? [],
        body.domains ?? [],
      ),
    };
  }
}
