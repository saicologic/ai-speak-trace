import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Transcription } from '../transcription/types/transcription.types';
import { GuardrailService } from './guardrail.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PiiFinding, PrivacyScan, PrivacyStatus } from './privacy.types';
import {
  maskTranscription,
  toFindings,
  toScanText,
  withoutIgnoredPii,
} from './privacy.utils';

/**
 * 会話を外部（Claude など）に送る前の個人情報チェック
 *
 * ディープサーチで会話を選んだときに Guardrails で個人情報を検出して保存する。
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
    const scan = await this.store.find(transcriptionId);
    return {
      configured: this.guardrail.isConfigured(),
      scanning: this.running.has(transcriptionId),
      ...(this.errors.has(transcriptionId) && {
        error: this.errors.get(transcriptionId),
      }),
      // 以前のチェックで保存した、個人情報として扱わない検出（ユーザー名・国名だけの住所）は表示しない
      scan: scan && { ...scan, findings: withoutIgnoredPii(scan.findings) },
    };
  }

  /**
   * 個人情報を検出して保存する（前回の「伏せる／伏せない」の選択は引き継ぐ）
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
   * 話者名の更新時に呼ぶ（Guardrail ID が未設定なら何もしない。失敗しても文字起こしは止めない）
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

  /**
   * 確認済みの会話だけ、検出し直す（話者名を実名に変えた場合に備える。伏せる選択は引き継ぐ）
   * まだ確認していない会話は、ディープサーチで選ばれるまで Guardrails に送らない
   */
  rescanIfChecked(transcription: Transcription): void {
    // 初回のチェックの実行中は、まだ結果が保存されていないため、実行中かどうかも見る
    // （変更前の話者名で検出した結果だけが残り、変更後の実名を伏せられなくなるのを防ぐ）
    const wasRunning = this.running.has(transcription.id);
    this.store
      .find(transcription.id)
      .then((scan) => {
        if (scan || wasRunning) this.scanInBackground(transcription);
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `個人情報チェックの結果を読めません: ${transcription.id}`,
          error instanceof Error ? error.message : error,
        );
      });
  }

  /** 実行中のチェックと、その後に予約された検出し直しが終わるまで待つ（失敗しても待つのをやめる） */
  async waitForScans(transcriptionId: string): Promise<void> {
    for (;;) {
      const running = this.running.get(transcriptionId);
      if (!running && !this.pending.has(transcriptionId)) return;
      await (running ?? Promise.resolve()).catch(() => undefined);
      // 予約された検出し直しが始まるのを待つ
      await new Promise((resolve) => setImmediate(resolve));
    }
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
