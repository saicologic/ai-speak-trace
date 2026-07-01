import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { GenerateQuestionsDto } from './dto/generate-questions.dto';
import { AnalyzeDto } from './dto/analyze.dto';
import { AnalyzeContextDto } from './dto/analyze-context.dto';

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

  /** 発言の文脈分析: POST /api/interview/analyze-context */
  @Post('analyze-context')
  async analyzeContext(@Body() dto: AnalyzeContextDto) {
    const analysis = await this.interviewService.analyzeContext(
      dto.transcriptionId,
      dto.utteranceIndices,
    );
    return { analysis };
  }

  /** 分析ログ一覧: GET /api/interview/logs */
  @Get('logs')
  async findAnalysisLogs() {
    const logs = await this.interviewService.findAnalysisLogs();
    return { logs };
  }

  /** 分析ログ詳細: GET /api/interview/logs/:id */
  @Get('logs/:id')
  async findAnalysisLogById(@Param('id') id: string) {
    const log = await this.interviewService.findAnalysisLogById(id);
    return { log };
  }

  /** 要約設定（デフォルトプロンプト・モデル一覧）取得: GET /api/interview/summary-config */
  @Get('summary-config')
  getSummaryConfig() {
    return this.interviewService.getSummaryConfig();
  }

  /** 要約生成: POST /api/interview/summarize */
  @Post('summarize')
  async summarize(@Body() body: { transcriptionId: string; model: string; prompt: string }) {
    const summary = await this.interviewService.summarize(
      body.transcriptionId,
      body.model,
      body.prompt,
    );
    return { summary };
  }

  /** 要約ログ一覧: GET /api/interview/summary-logs */
  @Get('summary-logs')
  async findSummaryLogs() {
    const logs = await this.interviewService.findSummaryLogs();
    return { logs };
  }

  /** 要約ログ詳細: GET /api/interview/summary-logs/:id */
  @Get('summary-logs/:id')
  async findSummaryLogById(@Param('id') id: string) {
    const log = await this.interviewService.findSummaryLogById(id);
    return { log };
  }
}
