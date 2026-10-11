import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { Transcription } from '../transcription/types/transcription.types';
import { CLAUDE_MODEL } from '../claude/analysis.service';
import {
  ResearchJobDeletedError,
  ResearchJobStore,
} from './research-job.store';
import { GuardrailService } from '../privacy/guardrail.service';
import { PrivacyService } from '../privacy/privacy.service';
import {
  extractEnglish,
  GROUNDING_THRESHOLD,
  groundingTarget,
  toOutputChecks,
} from './research-guardrails';
import {
  JUDGE_MODEL,
  RawJudgement,
  ResearchClaudeService,
  TranscriptDocument,
} from './research-claude.service';
import {
  ClaimCheck,
  DomainProposal,
  EthicsCheck,
  PreSendChecks,
  ReportSegment,
  ResearchEvaluation,
  ResearchJob,
  ResearchJobSummary,
  ResearchTarget,
} from './types/research.types';
import {
  checkPersonalData,
  countOccurrences,
  findMentions,
  normalizeDomain,
  toTranscriptDocument,
  toTranscriptUtterances,
  verifyQuotes,
} from './research.utils';

/** Claude に全文を渡す会話の合計文字数の上限（超える場合は会話を減らしてもらう） */
export const MAX_TRANSCRIPT_CHARS = 300_000;

/** 実行中の状態（アプリの再起動で中断された調査の判定に使う） */
const RUNNING_STATUSES = [
  'proposing',
  'researching',
  'analyzing',
  'evaluating',
];

/**
 * ディープサーチ（調査）を段階的に進めるサービス
 *
 * 開始すると ①会話の読み込み・②提案 を行い、ユーザーの確定を待つ。
 * 確定後に ③Web調査 → ④統合分析 → ⑤評価 を行う。各段階の結果は ResearchJobStore に保存する。
 */
@Injectable()
export class ResearchService implements OnModuleInit {
  private readonly logger = new Logger(ResearchService.name);
  /** 確定の処理中の調査ID（同じ調査を二重に開始しないため） */
  private readonly confirming = new Set<string>();

  constructor(
    private readonly transcriptionStore: TranscriptionStoreService,
    private readonly jobStore: ResearchJobStore,
    private readonly claude: ResearchClaudeService,
    private readonly guardrail: GuardrailService,
    private readonly privacy: PrivacyService,
  ) {}

  /** アプリの再起動で中断された調査を、失敗として記録する */
  async onModuleInit(): Promise<void> {
    for (const summary of await this.jobStore.findAllSummaries()) {
      if (!RUNNING_STATUSES.includes(summary.status)) continue;
      const job = await this.jobStore.findById(summary.id);
      if (job) {
        await this.update(job, {
          status: 'failed',
          error: 'アプリの再起動で中断しました。もう一度調査を開始してください',
        });
      }
    }
  }

  async findAll(): Promise<ResearchJobSummary[]> {
    return this.jobStore.findAllSummaries();
  }

  async findById(id: string): Promise<ResearchJob> {
    const job = await this.jobStore.findById(id);
    if (!job) throw new NotFoundException('調査が見つかりません');
    return job;
  }

  /** ①② 調査を開始する（提案はバックグラウンドで行い、すぐにジョブを返す） */
  async start(
    transcriptionIds: string[],
    frequentWords: { word: string; count: number }[] = [],
  ): Promise<ResearchJob> {
    if (!Array.isArray(transcriptionIds) || transcriptionIds.length === 0) {
      throw new BadRequestException('調査する会話を選択してください');
    }
    // 会話を読み込む前の時刻を作成時刻にする（読み込み後に会話が削除された場合に、保存しないため）
    const now = new Date().toISOString();
    const transcriptions = await this.loadTranscriptions(transcriptionIds);
    const totalChars = transcriptions.reduce(
      (sum, t) => sum + toTranscriptDocument(t).length,
      0,
    );
    if (totalChars > MAX_TRANSCRIPT_CHARS) {
      throw new BadRequestException(
        `選んだ会話が長すぎます（${totalChars.toLocaleString()}文字）。合計${MAX_TRANSCRIPT_CHARS.toLocaleString()}文字以内になるよう、会話を減らしてください`,
      );
    }

    const job: ResearchJob = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'proposing',
      transcriptionIds,
      transcriptionNames: Object.fromEntries(
        transcriptions.map((t) => [t.id, t.audioFileName]),
      ),
      models: { analysis: CLAUDE_MODEL },
      preSendChecks: await this.privacyChecks(transcriptionIds),
    };
    await this.jobStore.save(job);
    void this.runProposal(job, transcriptions, frequentWords);
    return job;
  }

  /** ② ユーザーが確定したキーワードと公式サイトで、③④⑤ を実行する（バックグラウンド） */
  async confirm(id: string, targets: ResearchTarget[]): Promise<ResearchJob> {
    if (this.confirming.has(id)) {
      throw new BadRequestException('この調査はすでに確定の処理中です');
    }
    this.confirming.add(id);
    try {
      return await this.confirmJob(id, targets);
    } finally {
      this.confirming.delete(id);
    }
  }

  private async confirmJob(
    id: string,
    targets: ResearchTarget[],
  ): Promise<ResearchJob> {
    const job = await this.findById(id);
    if (job.status !== 'awaiting_confirmation') {
      throw new BadRequestException('この調査は確定できる状態ではありません');
    }
    // 同じキーワードは1つにまとめ、公式サイトは正規化して重複を除く
    const byKeyword = new Map<string, Set<string>>();
    for (const t of targets) {
      const keyword = t.keyword.trim();
      if (!keyword) continue;
      const domains = byKeyword.get(keyword) ?? new Set<string>();
      for (const d of t.domains.map(normalizeDomain)) if (d) domains.add(d);
      byKeyword.set(keyword, domains);
    }
    if (byKeyword.size === 0) {
      throw new BadRequestException('キーワードを1つ以上選んでください');
    }
    const cleanTargets = Array.from(byKeyword, ([keyword, domains]) => ({
      keyword,
      domains: Array.from(domains),
    }));
    const updated = await this.update(job, {
      status: 'researching',
      confirmed: {
        keywords: cleanTargets.map((t) => t.keyword),
        domains: [...new Set(cleanTargets.flatMap((t) => t.domains))],
        targets: cleanTargets,
      },
    });
    void this.runResearch(updated);
    return updated;
  }

  private async runProposal(
    job: ResearchJob,
    transcriptions: Transcription[],
    frequentWords: { word: string; count: number }[],
  ): Promise<void> {
    try {
      const words = sendableWords(transcriptions, frequentWords);
      const raw = await this.claude.proposeKeywords(
        this.toDocuments(transcriptions),
        words.slice(0, 30),
      );
      const checked = raw.keywords.map((k) => ({
        keyword: k.keyword.trim(),
        reason: k.reason,
        frequency: countOccurrences(transcriptions, k.keyword),
        quotes: verifyQuotes(k.quotes, transcriptions),
        domains: uniqueDomains(k.domains),
      }));
      const keywords = checked
        // 会話に出てこないキーワードは提案しない
        .filter((k) => k.keyword && k.frequency > 0)
        .sort((a, b) => b.frequency - a.frequency);
      const domains = uniqueDomains(keywords.flatMap((k) => k.domains));
      await this.update(job, {
        status: 'awaiting_confirmation',
        proposal: { keywords, domains },
        preSendChecks: {
          ...(job.preSendChecks ?? { privacyConfigured: false, privacy: [] }),
          droppedFrequentWords: frequentWords.length - words.length,
          droppedKeywords: checked
            .filter((k) => k.keyword && k.frequency === 0)
            .map((k) => k.keyword),
          droppedQuotes: raw.keywords.reduce(
            (sum, k, i) => sum + k.quotes.length - checked[i].quotes.length,
            0,
          ),
        },
      });
    } catch (error) {
      await this.fail(job, error);
    }
  }

  /** 会話ごとに、個人情報チェックの結果（伏せて送る文字列・要確認のまま送る文字列）をまとめる */
  private async privacyChecks(
    transcriptionIds: string[],
  ): Promise<PreSendChecks> {
    let privacyConfigured = false;
    const privacy = await Promise.all(
      transcriptionIds.map(async (transcriptionId) => {
        const status = await this.privacy.getStatus(transcriptionId);
        privacyConfigured = status.configured;
        const findings = status.scan?.findings ?? [];
        const masked = findings.filter((f) => f.mask);
        return {
          transcriptionId,
          scanned: !!status.scan,
          maskedKinds: masked.length,
          maskedCount: masked.reduce((sum, f) => sum + f.count, 0),
          needsReview: findings.filter((f) => !f.mask && f.needsReview).length,
        };
      }),
    );
    return { privacyConfigured, privacy };
  }

  private async runResearch(job: ResearchJob): Promise<void> {
    try {
      const { keywords, domains, targets } = job.confirmed!;
      const transcriptions = await this.loadTranscriptions(
        job.transcriptionIds,
      );

      // ③ Web調査
      // 以前の形式（キーワードごとの公式サイトがない）は、すべてのキーワードで同じ公式サイトを調べる
      const { sources: webSources, failures } = await this.claude.researchWeb(
        targets ?? keywords.map((keyword) => ({ keyword, domains })),
      );
      job = await this.update(job, {
        status: 'analyzing',
        webSources,
        ...(failures.length > 0 && { webResearchFailures: failures }),
      });

      // ④ 統合分析
      const report = await this.claude.analyze(
        this.toDocuments(transcriptions),
        webSources,
        keywords,
      );
      job = await this.update(job, { status: 'evaluating', report });

      // ⑤ 評価（根拠のない主張は表示から除く）
      const judgement = await this.claude.judge(report, keywords);
      const grounding = await this.groundingScores(report);
      const { finalReport, evaluation } = evaluate(
        report,
        judgement,
        keywords,
        grounding,
      );
      evaluation.ethics.push(...(await this.outputChecks(finalReport)));
      evaluation.guardrails = this.guardrail.isConfigured()
        ? {
            guardrailId: this.guardrail.guardrailId,
            groundingThreshold: GROUNDING_THRESHOLD,
            groundingChecked: grounding.size,
          }
        : null;
      await this.update(job, {
        status: 'completed',
        report: finalReport,
        evaluation,
        mentions: findMentions(transcriptions, keywords),
        models: { analysis: CLAUDE_MODEL, judge: JUDGE_MODEL },
      });
    } catch (error) {
      await this.fail(job, error);
    }
  }

  /**
   * 英語の主張の根拠スコアを Guardrails で計算する（Guardrail ID が未設定なら計算しない）
   * 失敗した主張は、評価モデルの判定だけで扱う
   */
  private async groundingScores(
    report: ReportSegment[],
  ): Promise<Map<number, number>> {
    const scores = new Map<number, number>();
    if (!this.guardrail.isConfigured()) return scores;
    for (const [index, segment] of report.entries()) {
      const target = groundingTarget(segment);
      if (!target) continue;
      try {
        const score = await this.guardrail.checkGrounding(
          target.source,
          target.query,
          target.claim,
        );
        // Guardrail に根拠チェックの設定がない場合は、スコアがないため評価モデルの判定だけで扱う
        if (score) scores.set(index, score.grounding);
      } catch (error) {
        this.logger.warn(
          `根拠スコアを計算できません（${index}番目の文）`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return scores;
  }

  /** 統合分析の出力を Guardrails で確認する（Guardrail ID が未設定なら確認しない） */
  private async outputChecks(report: ReportSegment[]): Promise<EthicsCheck[]> {
    if (!this.guardrail.isConfigured()) return [];
    const text = report.map((s) => s.text).join('');
    try {
      const findings = await this.guardrail.inspect(text, 'OUTPUT');
      const english = extractEnglish(text);
      const englishWords = english
        ? (await this.guardrail.inspect(english, 'OUTPUT')).words
        : [];
      return toOutputChecks(findings, englishWords);
    } catch (error) {
      this.logger.warn(
        '統合分析の出力を Guardrails で確認できません',
        error instanceof Error ? error.message : error,
      );
      return [
        {
          item: 'Guardrails による出力の確認',
          passed: false,
          detail: `確認できませんでした: ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  }

  private async loadTranscriptions(ids: string[]): Promise<Transcription[]> {
    const transcriptions: Transcription[] = [];
    for (const id of ids) {
      // 個人情報チェックで「伏せる」と選んだ文字列は置き換えてから使う
      const t = await this.transcriptionStore.findForSending(id);
      if (!t) throw new NotFoundException(`文字起こしが見つかりません: ${id}`);
      transcriptions.push(t);
    }
    return transcriptions;
  }

  private toDocuments(transcriptions: Transcription[]): TranscriptDocument[] {
    return transcriptions.map((t) => ({
      id: t.id,
      name: t.audioFileName,
      text: toTranscriptDocument(t),
      utterances: toTranscriptUtterances(t),
    }));
  }

  /**
   * 調査ジョブを更新して保存する
   * 実行中に会話の削除でジョブが消された場合は、会話の内容を含む結果を再び保存しないよう、保存せずに中断する
   */
  private async update(
    job: ResearchJob,
    changes: Partial<ResearchJob>,
  ): Promise<ResearchJob> {
    if (!(await this.jobStore.findById(job.id))) {
      throw new ResearchJobDeletedError(
        `調査ジョブが削除されました: ${job.id}`,
      );
    }
    const updated = { ...job, ...changes, updatedAt: new Date().toISOString() };
    await this.jobStore.save(updated);
    return updated;
  }

  private async fail(job: ResearchJob, error: unknown): Promise<void> {
    if (error instanceof ResearchJobDeletedError) {
      this.logger.log(`削除された調査を中断しました: ${job.id}`);
      return;
    }
    this.logger.error(`調査に失敗: ${job.id}`, error);
    // 失敗の記録自体に失敗しても、例外を外に出さない（バックグラウンド処理のため）
    try {
      const latest = await this.jobStore.findById(job.id);
      // 削除されたジョブは記録し直さない
      if (!latest) return;
      await this.update(latest, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (saveError) {
      if (saveError instanceof ResearchJobDeletedError) return;
      this.logger.error(`調査の失敗を記録できません: ${job.id}`, saveError);
    }
  }
}

/** 提案された公式サイトを正規化し、重複を除く */
function uniqueDomains(domains: DomainProposal[]): DomainProposal[] {
  const seen = new Set<string>();
  return domains
    .map((d) => ({ ...d, domain: normalizeDomain(d.domain) }))
    .filter((d) => d.domain && !seen.has(d.domain) && seen.add(d.domain));
}

/** 統合分析の指示で決めた、各論点の項目名の行 */
const SECTION_LABEL =
  /^\*\*(一言でいうと|詳しく|会話での説明との違い|関連するキーワード|会話では|公式情報では|一致・相違・不足|示唆)\*\*[:：]?$/;

/**
 * 画面で数えた頻出語のうち、Claude に送る会話（個人情報チェックで伏せた後）に出てくる語だけを返す
 * 頻出語は伏せる前の会話から数えているため、伏せた氏名などが頻出語として送られないようにする
 * 回数も伏せた後の会話で数え直す
 */
export function sendableWords(
  transcriptions: Transcription[],
  frequentWords: { word: string; count: number }[],
): { word: string; count: number }[] {
  return frequentWords
    .map((w) => ({
      word: w.word,
      count: countOccurrences(transcriptions, w.word),
    }))
    .filter((w) => w.count > 0);
}

/**
 * レポートの構成の行か（論点のキーワードの「## 見出し」と、統合分析の指示で決めた項目名）
 * 判定がない文や除いた文からも、構成を保つために残す
 * 見出しや太字の行は事実の文のこともあるため、指示で決めたものに限る
 */
function isSectionLine(line: string, keywords: string[]): boolean {
  const heading = line.match(/^#{1,6}\s+(.+)$/);
  if (heading) return keywords.includes(heading[1].trim());
  return SECTION_LABEL.test(line);
}

/** 空行と構成の行だけでできているか */
function isStructureOnly(text: string, keywords: string[]): boolean {
  return text
    .split('\n')
    .map((line) => line.trim())
    .every((line) => line === '' || isSectionLine(line, keywords));
}

/** 「不足:」「推測:」と明記した注記の文と、関連するキーワードの列挙（事実の主張として審査しない） */
const NOTE_SENTENCE =
  /^(?:[-*]\s*)?(?:\*\*)?(?:不足|推測|関連するキーワード)(?:\*\*)?\s*[:：]/;

/**
 * ⑤ 判定結果から評価を計算し、根拠のない主張を除いたレポートを返す
 * 事実の主張で「裏付けなし」と判定されたもの、根拠が付いていないものを除く。
 * Guardrails の根拠スコアがある英語の主張は、評価モデルと Guardrails の両方が「根拠と合わない」と
 * 判定したときだけ除き、判定が分かれたものは表示を残して「要確認」にする
 */
export function evaluate(
  report: ReportSegment[],
  judgement: RawJudgement,
  keywords: string[],
  grounding: Map<number, number> = new Map(),
): { finalReport: ReportSegment[]; evaluation: ResearchEvaluation } {
  const verdicts = new Map(judgement.claims.map((c) => [c.index, c]));
  const removedIndexes = new Set<number>();
  const removedClaims: ClaimCheck[] = [];
  const reviewClaims: ClaimCheck[] = [];
  let factual = 0;
  let cited = 0;
  let supported = 0;

  report.forEach((segment, index) => {
    const v = verdicts.get(index);
    // 注記の文は、審査員の判定によらず事実の主張として扱わない
    if (NOTE_SENTENCE.test(segment.text.trim())) return;
    // 判定が返らなかった文は、見出しなどの構成の行だけを事実の主張でないものとして残す
    const isFactual = v ? v.factual : !isStructureOnly(segment.text, keywords);
    if (!isFactual) return;
    factual++;
    const hasCitation = segment.citations.length > 0;
    if (hasCitation) cited++;
    // 判定が返らなかった事実の主張は、裏付けを確認できないため除く
    const verdict = v?.verdict ?? 'unsupported';
    if (hasCitation && verdict === 'supported') supported++;
    const score = grounding.get(index);
    const judgeRejects = verdict === 'unsupported';
    const judgeReason = v?.reason ?? '判定が返りませんでした';
    if (hasCitation && score !== undefined) {
      const guardrailRejects = score < GROUNDING_THRESHOLD;
      const scoreNote = `Guardrails の根拠スコア ${score.toFixed(2)}`;
      if (judgeRejects && guardrailRejects) {
        removedIndexes.add(index);
        removedClaims.push({
          claim: segment.text.trim(),
          factual: true,
          verdict: 'unsupported',
          reason: `${judgeReason}（${scoreNote}）`,
          groundingScore: score,
        });
      } else if (judgeRejects || guardrailRejects) {
        reviewClaims.push({
          claim: segment.text.trim(),
          factual: true,
          verdict,
          reason: judgeRejects
            ? `評価モデルは裏付けなしと判定: ${judgeReason}（${scoreNote}）`
            : `${scoreNote}（しきい値 ${GROUNDING_THRESHOLD} 未満）。評価モデルの判定: ${verdict}`,
          groundingScore: score,
        });
      }
      return;
    }
    if (!hasCitation || judgeRejects) {
      removedIndexes.add(index);
      removedClaims.push({
        claim: segment.text.trim(),
        factual: true,
        verdict: 'unsupported',
        reason: v ? v.reason : '判定が返りませんでした',
      });
    }
  });

  // 除いた文に含まれる見出しは、レポートの構成を保つために残す
  const finalReport = report.flatMap((segment, i) => {
    if (!removedIndexes.has(i)) return [segment];
    const headings = segment.text
      .split('\n')
      .filter((line) => isSectionLine(line.trim(), keywords));
    return headings.length > 0
      ? [{ text: `\n\n${headings.join('\n\n')}\n`, citations: [] }]
      : [];
  });
  const webCitations = finalReport
    .flatMap((s) => s.citations)
    .filter((c) => c.sourceKind === 'web');

  return {
    finalReport,
    evaluation: {
      factualClaims: factual,
      citationCoverage: factual === 0 ? 1 : cited / factual,
      supportedRate: cited === 0 ? 0 : supported / cited,
      removedClaims,
      reviewClaims,
      officialSourceRate:
        webCitations.length === 0
          ? null
          : webCitations.filter((c) => c.official).length / webCitations.length,
      relevance: judgement.relevance,
      ethics: [
        checkPersonalData(finalReport),
        {
          item: '会話に登場する個人の性格・健康・思想・属性を推測していない',
          passed: judgement.ethics.no_sensitive_inference.passed,
          detail: judgement.ethics.no_sensitive_inference.detail,
        },
        {
          item: '個人を評価・選別する記述がない',
          passed: judgement.ethics.no_individual_judgement.passed,
          detail: judgement.ethics.no_individual_judgement.detail,
        },
      ],
      judgeModel: JUDGE_MODEL,
    },
  };
}
