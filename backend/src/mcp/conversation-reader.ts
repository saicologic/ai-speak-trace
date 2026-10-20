import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TRANSCRIPTION_FILE,
  listTranscriptionIds,
  readTranscriptionFile,
} from '../storage/local/transcription-files';
import {
  PRIVACY_SCANS_DIR,
  readPrivacyScan,
} from '../privacy/privacy-scan.store';
import { PiiFinding } from '../privacy/privacy.types';
import {
  maskText,
  maskTranscription,
  withoutIgnoredPii,
} from '../privacy/privacy.utils';
import { Transcription } from '../transcription/types/transcription.types';
import { MAX_ID_CHARS } from './mcp.constants';

/**
 * 個人情報チェックの状態
 * - checked: チェック済みで、要確認も残っていない（返す）
 * - unchecked: チェックしていない
 * - stale: チェックの後に文字起こしが変わった
 * - needs_review: 「要確認」の検出が残っている
 * - error: 文字起こしやチェックの結果を読めない（書き込み途中など）
 */
export type PrivacyState =
  | 'checked'
  | 'unchecked'
  | 'stale'
  | 'needs_review'
  | 'error';

/** 返さない理由（MCP クライアントにそのまま見せる） */
export const PRIVACY_REASONS: Record<
  Exclude<PrivacyState, 'checked'>,
  string
> = {
  unchecked:
    '個人情報チェックをしていません。アプリのディープサーチで会話を選び、個人情報チェックを行ってください',
  stale:
    '個人情報チェックの後に文字起こしが変わりました。アプリのディープサーチの「個人情報チェック」で、もう一度確認してください',
  needs_review:
    '個人情報チェックに「要確認」が残っています。アプリのディープサーチの「個人情報チェック」で、伏せるかどうかを選んでください',
  error:
    '文字起こしまたは個人情報チェックの結果を読めませんでした（保存中の可能性があります）。しばらくしてからもう一度試してください',
};

/** ツールが受け付けない呼び出し（監査ログの outcome は rejected。理由はクライアントに返す） */
export class ToolRejection extends Error {}

/** 伏せ字にした会話（返してよいもの） */
export interface MaskedConversation {
  id: string;
  /** 伏せ字にした文字起こし（話者名・本文・音声ファイル名） */
  transcription: Transcription;
  /** 伏せた文字列（キーワードを除くために使う。返さない） */
  maskedTexts: string[];
}

/** 一覧の1件 */
export interface ConversationEntry {
  id: string;
  privacy: PrivacyState;
  /** checked のときだけ */
  conversation?: MaskedConversation;
  /** 返さない理由（checked 以外） */
  reason?: string;
  /** 返さない会話でも示す項目（名前などを含まないもの）。読めなかった場合はない */
  createdAt?: string;
  utteranceCount?: number;
}

/**
 * 文字起こしを読み込み、個人情報チェックの状態を判定して伏せ字にする
 * MCP のツールは、会話をここを通してだけ読む（伏せ字にしていない本文を返さないため）
 */
export class ConversationReader {
  private readonly transcriptionsDir: string;
  private readonly privacyScansDir: string;

  constructor(readonly dataDir: string) {
    this.transcriptionsDir = path.join(dataDir, 'transcriptions');
    this.privacyScansDir = path.join(dataDir, PRIVACY_SCANS_DIR);
  }

  /** すべての会話の状態（伏せ字にできたものは会話も） */
  async list(): Promise<ConversationEntry[]> {
    const ids = await listTranscriptionIds(this.transcriptionsDir);
    const entries: ConversationEntry[] = [];
    for (const id of ids) entries.push(await this.load(id));
    return entries;
  }

  /**
   * 指定した会話を伏せ字にして返す
   * 不正な ID・存在しない会話・返さない会話は ToolRejection
   */
  async get(id: string): Promise<MaskedConversation> {
    await this.assertKnownId(id);
    const entry = await this.load(id);
    if (!entry.conversation) {
      throw new ToolRejection(
        `この会話は返せません（${entry.privacy}）: ${entry.reason}`,
      );
    }
    return entry.conversation;
  }

  /**
   * 伏せ字にしていない文字起こし（GiNZA のキーワードの並べ替えにだけ使う。返さない）
   * 読めないものは除く
   */
  async readRawAll(): Promise<Transcription[]> {
    const result: Transcription[] = [];
    for (const id of await listTranscriptionIds(this.transcriptionsDir)) {
      try {
        const t = await readTranscriptionFile(this.transcriptionsDir, id);
        if (t && isTranscription(t)) result.push(t);
      } catch {
        // 書き込み途中などで読めない会話は、並べ替えに使わない
      }
    }
    return result;
  }

  /**
   * ID を確かめる
   * 日本語や空白を含むファイル名から作られるため文字種では絞らず、パスとして危ないものだけを拒否し、
   * transcriptions/ の一覧に完全に一致するものだけを使う（ID からパスを組み立てて直接開かない）
   */
  async assertKnownId(id: string): Promise<void> {
    if (!isSafeId(id)) {
      throw new ToolRejection('transcriptionId が不正です');
    }
    const ids = await listTranscriptionIds(this.transcriptionsDir);
    if (!ids.includes(id)) {
      throw new ToolRejection(
        `会話が見つかりません: ${id}（list_transcriptions で ID を確かめてください）`,
      );
    }
  }

  private async load(id: string): Promise<ConversationEntry> {
    let transcription: Transcription | null;
    let scan: Awaited<ReturnType<typeof readPrivacyScan>>;
    let modifiedAt: number;
    try {
      transcription = await readTranscriptionFile(this.transcriptionsDir, id);
      if (!transcription || !isTranscription(transcription)) {
        return this.reject(id, 'error');
      }
      scan = await readPrivacyScan(this.privacyScansDir, id);
      modifiedAt = (
        await fs.stat(path.join(this.transcriptionsDir, id, TRANSCRIPTION_FILE))
      ).mtimeMs;
    } catch {
      return this.reject(id, 'error');
    }
    const known = {
      createdAt: transcription.createdAt,
      utteranceCount: transcription.utterances.length,
    };
    if (!scan) return this.reject(id, 'unchecked', known);
    if (!Array.isArray(scan.findings)) return this.reject(id, 'error');

    const scannedAt = Date.parse(scan.scannedAt);
    if (Number.isNaN(scannedAt) || modifiedAt > scannedAt) {
      return this.reject(id, 'stale', known);
    }
    // アプリの画面に出さない検出（ユーザー名・国名だけの住所など）は、利用者が選べないため要確認として扱わない
    const findings = withoutIgnoredPii(scan.findings);
    if (findings.some((f) => f.needsReview)) {
      return this.reject(id, 'needs_review', known);
    }
    return {
      id,
      privacy: 'checked',
      conversation: mask(id, transcription, scan.findings),
    };
  }

  private reject(
    id: string,
    privacy: Exclude<PrivacyState, 'checked'>,
    known?: { createdAt: string; utteranceCount: number },
  ): ConversationEntry {
    return { id, privacy, reason: PRIVACY_REASONS[privacy], ...known };
  }
}

/** アプリが Claude に送るときと同じ方法（PrivacyService.maskForSending）で伏せ字にする */
function mask(
  id: string,
  transcription: Transcription,
  findings: PiiFinding[],
): MaskedConversation {
  const masked = maskTranscription(transcription, findings);
  return {
    id,
    transcription: {
      ...masked,
      // 音声ファイル名に名前などが入っていることがあるため、ファイル名も伏せる
      audioFileName: maskText(transcription.audioFileName ?? '', findings),
    },
    maskedTexts: findings.filter((f) => f.mask && f.text).map((f) => f.text),
  };
}

/** パスとして危ない ID（区切り文字・NUL・. と ..・長すぎるもの）ではないか */
export function isSafeId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_ID_CHARS &&
    !/[/\\\0]/.test(id) &&
    id !== '.' &&
    id !== '..'
  );
}

/** 読み込んだ値が、ツールで使う項目を持つ文字起こしか */
function isTranscription(value: Transcription): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.utterances) &&
    Array.isArray(value.speakers) &&
    value.utterances.every(
      (u) =>
        typeof u === 'object' &&
        u !== null &&
        typeof u.text === 'string' &&
        typeof u.speakerName === 'string',
    )
  );
}
