import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
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
      transcriptionIds?: unknown;
      frequentWords?: unknown;
    },
  ) {
    const transcriptionIds = requireStringArray(
      body?.transcriptionIds,
      'transcriptionIds',
    );
    const frequentWords = body?.frequentWords ?? [];
    if (
      !Array.isArray(frequentWords) ||
      !frequentWords.every(
        (w: unknown) =>
          typeof w === 'object' &&
          w !== null &&
          typeof (w as { word?: unknown }).word === 'string' &&
          typeof (w as { count?: unknown }).count === 'number',
      )
    ) {
      throw new BadRequestException('frequentWords の形式が正しくありません');
    }
    return {
      job: await this.researchService.start(
        transcriptionIds,
        frequentWords as { word: string; count: number }[],
      ),
    };
  }

  /** キーワードと公式サイトの確定（③Web調査・④統合分析・⑤評価）: POST /api/research/:id/confirm */
  @Post(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: { keywords?: unknown; domains?: unknown },
  ) {
    return {
      job: await this.researchService.confirm(
        id,
        requireStringArray(body?.keywords ?? [], 'keywords'),
        requireStringArray(body?.domains ?? [], 'domains'),
      ),
    };
  }
}

/** 文字列の配列であることを確認する（違う場合は 400 を返す） */
function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new BadRequestException(`${name} は文字列の配列で指定してください`);
  }
  return value;
}
