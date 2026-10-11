import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_FEATURES,
  FeedbackCategory,
  FeedbackFeature,
} from './types/feedback.types';

const MAX_QUOTE_CHARS = 1000;
const MAX_COMMENT_CHARS = 2000;

/** AI が生成した結果への、誤りの報告の API */
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /** 報告の一覧: GET /api/feedback?feature=summary&targetId=... */
  @Get()
  async find(
    @Query('feature') feature?: string,
    @Query('targetId') targetId?: string,
  ) {
    return { feedback: await this.feedbackService.find({ feature, targetId }) };
  }

  /** 報告: POST /api/feedback */
  @Post()
  async create(
    @Body()
    body: {
      feature?: unknown;
      targetId?: unknown;
      transcriptionId?: unknown;
      category?: unknown;
      quote?: unknown;
      comment?: unknown;
    },
  ) {
    const feature = body?.feature;
    if (!FEEDBACK_FEATURES.includes(feature as FeedbackFeature)) {
      throw new BadRequestException('feature が正しくありません');
    }
    const category = body?.category;
    if (!FEEDBACK_CATEGORIES.includes(category as FeedbackCategory)) {
      throw new BadRequestException('category が正しくありません');
    }
    const transcriptionId = body?.transcriptionId;
    if (typeof transcriptionId !== 'string' || !transcriptionId.trim()) {
      throw new BadRequestException('transcriptionId を指定してください');
    }
    const quote = optionalString(body?.quote, 'quote', MAX_QUOTE_CHARS);
    const comment = optionalString(body?.comment, 'comment', MAX_COMMENT_CHARS);
    if (!quote && !comment && category === 'other') {
      throw new BadRequestException('「その他」の場合は、内容を書いてください');
    }
    return {
      feedback: await this.feedbackService.create({
        feature: feature as FeedbackFeature,
        targetId: optionalString(body?.targetId, 'targetId', 200),
        transcriptionId,
        category: category as FeedbackCategory,
        quote,
        comment,
      }),
    };
  }
}

function optionalString(value: unknown, name: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} は文字列で指定してください`);
  }
  if (value.length > max) {
    throw new BadRequestException(`${name} は${max}文字以内にしてください`);
  }
  return value.trim();
}
