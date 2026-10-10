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
  async scan(transcription: Transcription): Promise<PrivacyScan> {
    if (!this.guardrail.isConfigured()) {
      throw new BadRequestException(
        '設定画面で Guardrail ID を設定してください',
      );
    }
    const inFlight = this.running.get(transcription.id);
    if (inFlight) return inFlight;
    const task = this.runScan(transcription).finally(() =>
      this.running.delete(transcription.id),
    );
    this.running.set(transcription.id, task);
    return task;
  }

  /** 文字起こしの完了時に呼ぶ（Guardrail ID が未設定なら何もしない。失敗しても文字起こしは止めない） */
  scanInBackground(transcription: Transcription): void {
    if (!this.guardrail.isConfigured()) return;
    this.scan(transcription).catch((error: unknown) => {
      this.logger.warn(
        `個人情報チェックに失敗: ${transcription.id}`,
        error instanceof Error ? error.message : error,
      );
    });
  }

  private async runScan(transcription: Transcription): Promise<PrivacyScan> {
    this.errors.delete(transcription.id);
    try {
      const text = toScanText(transcription);
      const detected = await this.guardrail.inspect(text, 'INPUT');
      const previous = await this.store.find(transcription.id);
      const scan: PrivacyScan = {
        transcriptionId: transcription.id,
        scannedAt: new Date().toISOString(),
        guardrailId: this.guardrail.guardrailId,
        guardrailVersion: this.guardrail.guardrailVersion,
        findings: toFindings(detected.pii, text, previous?.findings),
      };
      await this.store.save(scan);
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
    await this.store.save(updated);
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
