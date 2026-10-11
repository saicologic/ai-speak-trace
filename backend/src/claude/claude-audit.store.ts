import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Claude の呼び出しの記録の保存先（DATA_DIR 配下） */
export const CLAUDE_AUDIT_DIR = 'claude-audit-logs';

/** Guardrails が検出した内容の記録（検出した文字列は残さず、種類と件数だけを残す） */
export interface GuardrailCheckRecord {
  /** 個人情報の種類ごとの件数 */
  piiTypes: Record<string, number>;
  /** 伏せた文字列の数 */
  masked: number;
  /** コンテンツフィルター（侮辱・プロンプト攻撃など）の検出 */
  content: { type: string; confidence: string }[];
}

/** Claude の呼び出し1回の記録 */
export interface ClaudeAuditRecord {
  /** 記録した日時（ISO 8601） */
  at: string;
  /** 呼び出した機能（summary・analysis など） */
  purpose: string;
  model: string;
  guardrailId: string;
  guardrailVersion: string;
  /**
   * 結果
   * - sent: 送って応答を返した
   * - blocked_input: 送る前の確認で止めた
   * - blocked_output: 応答の確認で止めた
   * - error: Guardrails や Claude の呼び出しに失敗した
   */
  outcome: 'sent' | 'blocked_input' | 'blocked_output' | 'error';
  /** 止めた理由・失敗の内容 */
  reason?: string;
  input?: GuardrailCheckRecord;
  output?: GuardrailCheckRecord;
}

/**
 * Claude の呼び出しと Guardrails の確認の結果を記録するストア
 *
 * いつ・どの機能で・どの Guardrail のバージョンで確認し、何を検出して伏せたか・止めたかを、
 * 後から確かめられるようにする。会話の内容と検出した文字列は残さない。
 * 月ごとの JSON Lines ファイル（2026-10.jsonl など）に追記する。
 */
@Injectable()
export class ClaudeAuditStore {
  private readonly logger = new Logger(ClaudeAuditStore.name);
  private readonly storeDir: string;

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.storeDir = path.resolve(path.join(dataDir, CLAUDE_AUDIT_DIR));
  }

  /** 記録を追記する（記録に失敗しても、Claude の呼び出しは止めない） */
  async append(record: ClaudeAuditRecord): Promise<void> {
    try {
      await fs.mkdir(this.storeDir, { recursive: true });
      const file = path.join(this.storeDir, `${record.at.slice(0, 7)}.jsonl`);
      await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf-8');
    } catch (error) {
      this.logger.warn(`Claude の呼び出しを記録できませんでした: ${error}`);
    }
  }
}

/** 個人情報の検出を、種類ごとの件数にまとめる */
export function countPiiTypes(pii: { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { type } of pii) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}
