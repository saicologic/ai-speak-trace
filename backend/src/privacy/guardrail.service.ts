import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplyGuardrailCommand,
  ApplyGuardrailCommandOutput,
  BedrockRuntimeClient,
  GuardrailAssessment,
} from '@aws-sdk/client-bedrock-runtime';

/** 1回の ApplyGuardrail に渡す文字数（Standard ティアのコンテンツフィルターの上限 500 テキストユニット未満） */
export const GUARDRAIL_CHUNK_CHARS = 30_000;

/** Guardrails が検出した内容 */
export interface GuardrailFindings {
  /** 個人情報（type は Guardrails の種類名。独自の正規表現は名前） */
  pii: { type: string; match: string }[];
  /** 単語フィルター（不適切な語の一覧）に一致した語 */
  words: string[];
  /** コンテンツフィルター（侮辱・暴力など）で検出された種類 */
  content: { type: string; confidence: string }[];
}

/** 根拠の確認（contextual grounding check）の点数 */
export interface GroundingScore {
  /** 根拠に合っている度合い（0〜1） */
  grounding: number;
  /** 質問に関係している度合い（0〜1） */
  relevance: number;
}

/**
 * Amazon Bedrock Guardrails の ApplyGuardrail を呼び出すサービス
 *
 * Guardrail は「検出のみ」（アクションなし）で作る前提。テキストは書き換えず、検出した内容だけを返す。
 * Guardrail ID が設定されていない場合は使わない（isConfigured が false）。
 */
@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);
  private client?: BedrockRuntimeClient;

  constructor(private readonly configService: ConfigService) {}

  get guardrailId(): string {
    return (
      this.configService.get<string>('BEDROCK_GUARDRAIL_ID') ?? ''
    ).trim();
  }

  get guardrailVersion(): string {
    return (
      (
        this.configService.get<string>('BEDROCK_GUARDRAIL_VERSION') ?? ''
      ).trim() || 'DRAFT'
    );
  }

  isConfigured(): boolean {
    return this.guardrailId !== '';
  }

  private getClient(): BedrockRuntimeClient {
    this.client ??= new BedrockRuntimeClient({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-1'),
    });
    return this.client;
  }

  /**
   * テキストに含まれる個人情報・不適切な語・不適切な表現を検出する（長い場合は分けて送る）
   * requireFullCoverage が true の場合、Guardrails が一部の文字をチェックしなかったときは例外を投げる
   * （Claude に送る前のチェックで、チェックされていない文字を送らないため）
   */
  async inspect(
    text: string,
    source: 'INPUT' | 'OUTPUT',
    { requireFullCoverage = false }: { requireFullCoverage?: boolean } = {},
  ): Promise<GuardrailFindings> {
    const findings: GuardrailFindings = { pii: [], words: [], content: [] };
    for (const chunk of splitText(text, GUARDRAIL_CHUNK_CHARS)) {
      const response = await this.send(source, [{ text: { text: chunk } }]);
      const coverage = response.guardrailCoverage?.textCharacters;
      // カバレッジが返らない場合も、すべての文字がチェックされたか確かめられないため止める
      if (
        requireFullCoverage &&
        (coverage?.guarded === undefined ||
          coverage.total === undefined ||
          coverage.guarded < coverage.total)
      ) {
        throw new Error(
          `Guardrails がチェックしなかった文字があります（${coverage?.guarded ?? '不明'}/${coverage?.total ?? '不明'}文字）`,
        );
      }
      for (const a of response.assessments ?? []) mergeAssessment(findings, a);
    }
    return findings;
  }

  /** 主張（claim）が根拠（source）に合っているかの点数（英語のみ対応。根拠チェックの設定がなければ null） */
  async checkGrounding(
    source: string,
    query: string,
    claim: string,
  ): Promise<GroundingScore | null> {
    const assessments = await this.apply('OUTPUT', [
      { text: { text: source, qualifiers: ['grounding_source'] } },
      { text: { text: query, qualifiers: ['query'] } },
      { text: { text: claim, qualifiers: ['guard_content'] } },
    ]);
    const filters = assessments.flatMap(
      (a) => a.contextualGroundingPolicy?.filters ?? [],
    );
    // Guardrail に根拠チェック（contextual grounding）の設定がない場合はスコアが返らない
    const grounding = filters.find((f) => f.type === 'GROUNDING')?.score;
    if (grounding === undefined) return null;
    const relevance = filters.find((f) => f.type === 'RELEVANCE')?.score ?? 0;
    return { grounding, relevance };
  }

  private async apply(
    source: 'INPUT' | 'OUTPUT',
    content: ConstructorParameters<typeof ApplyGuardrailCommand>[0]['content'],
  ): Promise<GuardrailAssessment[]> {
    return (await this.send(source, content)).assessments ?? [];
  }

  private async send(
    source: 'INPUT' | 'OUTPUT',
    content: ConstructorParameters<typeof ApplyGuardrailCommand>[0]['content'],
  ): Promise<ApplyGuardrailCommandOutput> {
    if (!this.isConfigured()) {
      throw new Error('Guardrail ID が設定されていません');
    }
    const response = await this.getClient().send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: this.guardrailId,
        guardrailVersion: this.guardrailVersion,
        source,
        content,
        outputScope: 'FULL',
      }),
    );
    this.logger.debug(
      `ApplyGuardrail: source=${source}, action=${response.action}`,
    );
    return response;
  }
}

/** 行の区切りを優先して、指定した文字数以下に分ける */
export function splitText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    // 1行が長すぎる場合は、文字数で切る
    for (let i = 0; i < Math.max(line.length, 1); i += maxChars) {
      const piece = line.slice(i, i + maxChars);
      if (current && current.length + 1 + piece.length > maxChars) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** ApplyGuardrail の評価結果から、検出された内容を集める */
export function mergeAssessment(
  findings: GuardrailFindings,
  assessment: GuardrailAssessment,
): void {
  const sensitive = assessment.sensitiveInformationPolicy;
  for (const e of sensitive?.piiEntities ?? []) {
    if (e.detected !== false && e.type && e.match) {
      findings.pii.push({ type: e.type, match: e.match });
    }
  }
  for (const r of sensitive?.regexes ?? []) {
    if (r.detected !== false && r.name && r.match) {
      findings.pii.push({ type: r.name, match: r.match });
    }
  }
  const word = assessment.wordPolicy;
  for (const w of [
    ...(word?.customWords ?? []),
    ...(word?.managedWordLists ?? []),
  ]) {
    if (w.detected !== false && w.match && !findings.words.includes(w.match)) {
      findings.words.push(w.match);
    }
  }
  for (const f of assessment.contentPolicy?.filters ?? []) {
    if (
      f.detected !== false &&
      f.type &&
      f.confidence &&
      f.confidence !== 'NONE'
    ) {
      findings.content.push({ type: f.type, confidence: f.confidence });
    }
  }
}
