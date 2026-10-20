import { createHmac, randomBytes } from 'crypto';
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
import { PiiFinding, PrivacyScan } from '../privacy/privacy.types';
import {
  maskText,
  maskTranscription,
  withoutIgnoredPii,
} from '../privacy/privacy.utils';
import { Transcription } from '../transcription/types/transcription.types';
import { maskContacts } from './contact-patterns';

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

/** 外に返す会話の ID の形（t_ と16進数24文字） */
const HANDLE_PATTERN = /^t_[0-9a-f]{24}$/;

/** 伏せ字にした会話（返してよいもの） */
export interface MaskedConversation {
  /** 外に返す会話の ID（ファイル名を含まない。handleOf を参照） */
  id: string;
  /** 文字起こしのフォルダ名（監査ログと、伏せる前の発話のハッシュにだけ使う。返さない） */
  sourceId: string;
  /** 伏せ字にした文字起こし（話者名・本文） */
  transcription: Transcription;
  /** 伏せた文字列（キーワードを除くために使う。返さない） */
  maskedTexts: string[];
}

/** 一覧の1件 */
export interface ConversationEntry {
  /** 外に返す会話の ID */
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

  /**
   * - handleKey: 外に返す会話の ID を作る鍵。既定はプロセスごとに作り直す
   *   （ファイル名から作った ID を推測で戻せないようにするため。サーバーを起動し直すと ID は変わる）
   */
  constructor(
    readonly dataDir: string,
    private readonly handleKey: Buffer = randomBytes(32),
  ) {
    this.transcriptionsDir = path.join(dataDir, 'transcriptions');
    this.privacyScansDir = path.join(dataDir, PRIVACY_SCANS_DIR);
  }

  /**
   * 外に返す会話の ID
   * 文字起こしのフォルダ名は音声ファイル名から作られ、名前などを含むことがあるため、そのまま返さない
   */
  handleOf(sourceId: string): string {
    const digest = createHmac('sha256', this.handleKey)
      .update(sourceId)
      .digest('hex');
    return `t_${digest.slice(0, 24)}`;
  }

  /** すべての会話の状態（伏せ字にできたものは会話も） */
  async list(): Promise<ConversationEntry[]> {
    const entries: ConversationEntry[] = [];
    for (const sourceId of await listTranscriptionIds(this.transcriptionsDir)) {
      entries.push(await this.load(sourceId));
    }
    return entries;
  }

  /**
   * 指定した会話を伏せ字にして返す
   * 不正な ID・存在しない会話・返さない会話は ToolRejection
   */
  async get(id: string): Promise<MaskedConversation> {
    const entry = await this.load(await this.resolve(id));
    if (!entry.conversation) {
      throw new ToolRejection(
        `この会話は返せません（${entry.privacy}）: ${entry.reason}`,
      );
    }
    return entry.conversation;
  }

  /**
   * 伏せ字にしていない文字起こし（GiNZA のキャッシュのハッシュを確かめるためだけに使う。返さない）
   * 読めない場合は null
   */
  async readUnmasked(
    conversation: MaskedConversation,
  ): Promise<Transcription | null> {
    try {
      const t = await readTranscriptionFile(
        this.transcriptionsDir,
        conversation.sourceId,
      );
      return t && isTranscription(t) ? t : null;
    } catch {
      return null;
    }
  }

  /**
   * 監査ログに残す文字列（検索語など）を伏せる
   * どの会話で検出された文字列も、「伏せる」を選んだかどうかにかかわらず伏せ、連絡先なども伏せる
   */
  async redactForAudit(text: string): Promise<string> {
    const findings: PiiFinding[] = [];
    for (const sourceId of await listTranscriptionIds(this.transcriptionsDir)) {
      try {
        const scan = await readPrivacyScan(this.privacyScansDir, sourceId);
        if (scan && Array.isArray(scan.findings)) {
          for (const f of scan.findings) {
            if (typeof f?.text === 'string' && typeof f.label === 'string') {
              findings.push({ ...f, mask: true });
            }
          }
        }
      } catch {
        // 読めない結果は使わない
      }
    }
    return maskContacts(maskText(text, findings));
  }

  /** 外に返した ID から、文字起こしのフォルダ名を探す */
  private async resolve(id: string): Promise<string> {
    if (!HANDLE_PATTERN.test(id)) {
      throw new ToolRejection(
        'transcriptionId が不正です（list_transcriptions の id を渡してください）',
      );
    }
    const ids = await listTranscriptionIds(this.transcriptionsDir);
    const sourceId = ids.find((s) => this.handleOf(s) === id);
    if (!sourceId) {
      throw new ToolRejection(
        `会話が見つかりません: ${id}（サーバーを起動し直すと id は変わります。list_transcriptions で id を確かめてください）`,
      );
    }
    return sourceId;
  }

  private async load(sourceId: string): Promise<ConversationEntry> {
    const id = this.handleOf(sourceId);
    let transcription: Transcription | null;
    let scan: PrivacyScan | null;
    let modifiedAt: number;
    try {
      transcription = await readTranscriptionFile(
        this.transcriptionsDir,
        sourceId,
      );
      if (!transcription || !isTranscription(transcription)) {
        return reject(id, 'error');
      }
      scan = await readPrivacyScan(this.privacyScansDir, sourceId);
      modifiedAt = (
        await fs.stat(
          path.join(this.transcriptionsDir, sourceId, TRANSCRIPTION_FILE),
        )
      ).mtimeMs;
    } catch {
      return reject(id, 'error');
    }
    const known = {
      createdAt:
        typeof transcription.createdAt === 'string'
          ? transcription.createdAt
          : undefined,
      utteranceCount: transcription.utterances.length,
    };
    if (!scan) return reject(id, 'unchecked', known);
    if (!isFindings(scan.findings)) return reject(id, 'error');

    const scannedAt = Date.parse(scan.scannedAt);
    if (Number.isNaN(scannedAt) || modifiedAt > scannedAt) {
      return reject(id, 'stale', known);
    }
    // アプリの画面に出さない検出（ユーザー名・国名だけの住所など）は、利用者が選べないため要確認として扱わない
    if (withoutIgnoredPii(scan.findings).some((f) => f.needsReview)) {
      return reject(id, 'needs_review', known);
    }
    try {
      return {
        id,
        privacy: 'checked',
        conversation: mask(id, sourceId, transcription, scan.findings),
      };
    } catch {
      // 形を確かめた後でも伏せ字にできない会話は、この1件だけを除く
      return reject(id, 'error');
    }
  }
}

function reject(
  id: string,
  privacy: Exclude<PrivacyState, 'checked'>,
  known?: { createdAt?: string; utteranceCount: number },
): ConversationEntry {
  return {
    id,
    privacy,
    reason: PRIVACY_REASONS[privacy],
    ...(known?.createdAt !== undefined && { createdAt: known.createdAt }),
    ...(known && { utteranceCount: known.utteranceCount }),
  };
}

/**
 * アプリが Claude に送るときと同じ方法（PrivacyService.maskForSending）で伏せ字にし、
 * さらに連絡先など（Guardrails を呼ばない代わりに、この Mac の中の正規表現で検出したもの）を伏せる
 */
function mask(
  id: string,
  sourceId: string,
  transcription: Transcription,
  findings: PiiFinding[],
): MaskedConversation {
  const masked = maskTranscription(transcription, findings);
  return {
    id,
    sourceId,
    transcription: {
      ...masked,
      id,
      // 音声ファイル名は個人情報チェックの対象ではなく、名前などが残ることがあるため返さない
      audioFileName: '',
      fullText: maskContacts(masked.fullText),
      speakers: masked.speakers.map((s) => ({
        ...s,
        name: maskContacts(s.name),
      })),
      utterances: masked.utterances.map((u) => ({
        ...u,
        speakerName: maskContacts(u.speakerName),
        text: maskContacts(u.text),
      })),
    },
    maskedTexts: findings.filter((f) => f.mask && f.text).map((f) => f.text),
  };
}

/** 検出結果が、伏せ字の処理で使える形か */
function isFindings(value: unknown): value is PiiFinding[] {
  return (
    Array.isArray(value) &&
    value.every(
      (f: Partial<PiiFinding> | null) =>
        typeof f === 'object' &&
        f !== null &&
        typeof f.text === 'string' &&
        typeof f.label === 'string' &&
        typeof f.type === 'string',
    )
  );
}

/** 読み込んだ値が、ツールと伏せ字の処理（maskTranscription）で使う項目を持つ文字起こしか */
function isTranscription(value: unknown): value is Transcription {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<Transcription>;
  const isWords = (words: unknown) =>
    Array.isArray(words) &&
    words.every(
      (w: { text?: unknown } | null) =>
        typeof w === 'object' && w !== null && typeof w.text === 'string',
    );
  return (
    typeof t.fullText === 'string' &&
    isWords(t.words) &&
    Array.isArray(t.speakers) &&
    t.speakers.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        typeof s.id === 'string' &&
        typeof s.name === 'string',
    ) &&
    Array.isArray(t.utterances) &&
    t.utterances.every(
      (u) =>
        typeof u === 'object' &&
        u !== null &&
        typeof u.speakerId === 'string' &&
        typeof u.speakerName === 'string' &&
        typeof u.text === 'string' &&
        typeof u.start === 'number' &&
        typeof u.end === 'number' &&
        isWords(u.words),
    )
  );
}
