import { Controller, Post, Body } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { GenerateQuestionsDto } from './dto/generate-questions.dto';
import { AnalyzeDto } from './dto/analyze.dto';

/** 会話分析APIコントローラー */
@Controller('interview')
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  /** 質問文自動生成: POST /api/interview/generate-questions */
  @Post('generate-questions')
  async generateQuestions(@Body() dto: GenerateQuestionsDto) {
    const questions = await this.interviewService.generateQuestions(
      dto.transcriptionId,
      dto.speakerId,
      dto.keywords,
    );
    return { questions };
  }

  /** プロンプトプレビュー: POST /api/interview/preview-prompts */
  @Post('preview-prompts')
  async previewPrompts(@Body() dto: AnalyzeDto) {
    const prompts = await this.interviewService.previewPrompts(
      dto.transcriptionId,
      dto.speakerId,
      dto.keywords,
      dto.questions,
    );
    return { prompts };
  }

  /** Web検索付き分析実行: POST /api/interview/analyze */
  @Post('analyze')
  async analyze(@Body() dto: AnalyzeDto) {
    const analysis = await this.interviewService.analyze(
      dto.transcriptionId,
      dto.speakerId,
      dto.keywords,
      dto.questions,
    );
    return { analysis };
  }
}
