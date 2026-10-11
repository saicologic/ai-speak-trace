import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Transcription } from '../transcription/types/transcription.types';
import { GuardrailService } from './guardrail.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PiiFinding, PrivacyScan, PrivacyStatus } from './privacy.types';
import { maskTranscription, toFindings, toScanText } from './privacy.utils';

/**
 * 会話を外部（Claude など）に送る前の個人情報チェック
 *
 * 文字起こしの完了時に Guardrails で個人情報を検出して保存する。
 * 送るときは、利用者が「伏せる」と選んだ文字列を置き換えた複製を使う。
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);
  /** チェック中の文字起こし（同じ文字起こしを同時に二重チェックしないため） */
  private readonly running = new Map<string, Promise<PrivacyScan>>();
  /**
   * 実行中のチェックが終わった後に検出し直す内容（文字起こしごとに最後に渡されたもの）
   * receivedAt は内容を受け取った時刻。待っている間に文字起こしが削除された場合に、結果を保存しないため
   */
  private readonly pending = new Map<
    string,
    { transcription: Transcription; receivedAt: string }
  >();
  /** 直近のチェックの失敗（画面に表示する） */
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly guardrail: GuardrailService,
    private readonly store: PrivacyScanStore,
  ) {}

  async getStatus(transcriptionId: string): Promise<PrivacyStatus> {
    return {
      configured: this.guardrail.isConfigured(),
      scanning: this.running.has(transcriptionId),
      ...(this.errors.has(transcriptionId) && {
        error: this.errors.get(transcriptionId),
      }),
      scan: await this.store.find(transcriptionId),
    };
  }

  /** 個人情報を検出して保存する（前回の「伏せる／伏せない」の選択は引き継ぐ） */
  /**
   * 個人情報を検出して保存する
   * receivedAt は文字起こしの内容を受け取った時刻で、その後に文字起こしが削除された場合は結果を保存しない
   */
  async scan(
    transcription: Transcription,
    receivedAt = new Date().toISOString(),
  ): Promise<PrivacyScan> {
    if (!this.guardrail.isConfigured()) {
      throw new BadRequestException(
        '設定画面で Guardrail ID を設定してください',
      );
    }
    const inFlight = this.running.get(transcription.id);
    if (inFlight) return inFlight;
    const task = this.runScan(transcription, receivedAt).finally(() =>
      this.running.delete(transcription.id),
    );
    this.running.set(transcription.id, task);
    return task;
  }

  /**
   * 文字起こしの完了時や話者名の更新時に呼ぶ（Guardrail ID が未設定なら何もしない。失敗しても文字起こしは止めない）
   * 実行中のチェックは変更前の内容（話者名など）で検出しているため、終わるのを待ってから、最後に渡された内容で検出し直す
   */
  scanInBackground(
    transcription: Transcription,
    receivedAt = new Date().toISOString(),
  ): void {
    if (!this.guardrail.isConfigured()) return;
    const id = transcription.id;
    const running = this.running.get(id);
    if (!running) {
      this.scan(transcription, receivedAt).catch((error: unknown) => {
        this.logger.warn(
          `個人情報チェックに失敗: ${id}`,
          error instanceof Error ? error.message : error,
        );
      });
      return;
    }
    // 待っている間に何度呼ばれても、最後に渡された内容で1回だけ検出し直す
    const waiting = this.pending.has(id);
    this.pending.set(id, { transcription, receivedAt });
    if (waiting) return;
    void running
      .catch(() => undefined)
      .then(() => {
        const latest = this.pending.get(id);
        this.pending.delete(id);
        if (latest) {
          this.scanInBackground(latest.transcription, latest.receivedAt);
        }
      });
  }

  private async runScan(
    transcription: Transcription,
    scannedAt: string,
  ): Promise<PrivacyScan> {
    this.errors.delete(transcription.id);
    try {
      const text = toScanText(transcription);
      const detected = await this.guardrail.inspect(text, 'INPUT');
      const previous = await this.store.find(transcription.id);
      const scan: PrivacyScan = {
        transcriptionId: transcription.id,
        // 内容を受け取った時刻（保存時に、この後で文字起こしが削除されていないかを確認する）
        scannedAt,
        guardrailId: this.guardrail.guardrailId,
        guardrailVersion: this.guardrail.guardrailVersion,
        findings: toFindings(detected.pii, text, previous?.findings),
      };
      if (!(await this.store.save(scan))) {
        this.logger.log(
          `チェック中に文字起こしが削除されたため、結果を保存しません: ${transcription.id}`,
        );
        return scan;
      }
      this.logger.log(
        `個人情報チェック完了: ${transcription.id}（${scan.findings.length}件）`,
      );
      return scan;
    } catch (error) {
      this.errors.set(
        transcription.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** 検出した文字列ごとに「伏せる／伏せない」を更新する（保存したものは確認済みにする） */
  async updateMasks(
    transcriptionId: string,
    masks: { type: string; text: string; mask: boolean }[],
  ): Promise<PrivacyScan> {
    const scan = await this.store.find(transcriptionId);
    if (!scan) {
      throw new BadRequestException('個人情報チェックの結果がありません');
    }
    const findings: PiiFinding[] = scan.findings.map((f) => {
      const choice = masks.find((m) => m.type === f.type && m.text === f.text);
      return choice ? { ...f, mask: choice.mask, needsReview: false } : f;
    });
    const updated = { ...scan, findings };
    if (!(await this.store.save(updated))) {
      throw new BadRequestException('文字起こしが削除されました');
    }
    return updated;
  }

  /** 外部に送る用に、伏せると選んだ文字列を置き換えた複製を返す（チェック前ならそのまま返す） */
  async maskForSending(transcription: Transcription): Promise<Transcription> {
    const scan = await this.store.find(transcription.id);
    return scan
      ? maskTranscription(transcription, scan.findings)
      : transcription;
  }
}
