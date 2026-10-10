import { Transcription } from '../transcription/types/transcription.types';
import { PiiFinding } from './privacy.types';

/** Guardrails の個人情報の種類の表示名 */
const PII_LABELS: Record<string, string> = {
  NAME: '氏名',
  ADDRESS: '住所',
  PHONE: '電話番号',
  EMAIL: 'メールアドレス',
  AGE: '年齢',
  USERNAME: 'ユーザー名',
  PASSWORD: 'パスワード',
  CREDIT_DEBIT_CARD_NUMBER: 'カード番号',
  IP_ADDRESS: 'IPアドレス',
  AWS_ACCESS_KEY: 'AWSアクセスキー',
  AWS_SECRET_KEY: 'AWSシークレットキー',
  JP_MY_NUMBER: 'マイナンバー',
};

export function piiLabel(type: string): string {
  return PII_LABELS[type] ?? type;
}

/** 個人情報チェックに送る本文（話者名も含める） */
export function toScanText(transcription: Transcription): string {
  return transcription.utterances
    .filter((u) => u.text.trim())
    .map((u) => `${u.speakerName}: ${u.text}`)
    .join('\n');
}

function countIn(text: string, target: string): number {
  return target ? text.split(target).length - 1 : 0;
}

/**
 * Guardrails の検出結果を、種類・文字列ごとにまとめる
 * 前回のチェックで利用者が選んだ「伏せる／伏せない」は引き継ぐ（新しく見つかったものは伏せる）
 */
export function toFindings(
  detected: { type: string; match: string }[],
  text: string,
  previous: PiiFinding[] = [],
): PiiFinding[] {
  const byKey = new Map<string, PiiFinding>();
  for (const { type, match } of detected) {
    const value = match.trim();
    if (!value) continue;
    const key = `${type}\u0000${value}`;
    if (byKey.has(key)) continue;
    const before = previous.find((p) => p.type === type && p.text === value);
    byKey.set(key, {
      type,
      label: piiLabel(type),
      text: value,
      count: Math.max(countIn(text, value), 1),
      mask: before?.mask ?? true,
    });
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

/** 伏せると選んだ文字列を [氏名] のような表示に置き換える（長い文字列から置き換える） */
export function maskText(text: string, findings: PiiFinding[]): string {
  const targets = findings
    .filter((f) => f.mask && f.text)
    .sort((a, b) => b.text.length - a.text.length);
  let result = text;
  for (const f of targets) {
    result = result.split(f.text).join(`[${f.label}]`);
  }
  return result;
}

/** 文字起こしの、伏せる文字列を置き換えた複製を返す（元の文字起こしは変更しない） */
export function maskTranscription(
  transcription: Transcription,
  findings: PiiFinding[],
): Transcription {
  if (!findings.some((f) => f.mask)) return transcription;
  const mask = (text: string) => maskText(text, findings);
  return {
    ...transcription,
    fullText: mask(transcription.fullText),
    speakers: transcription.speakers.map((s) => ({ ...s, name: mask(s.name) })),
    words: transcription.words.map((w) => ({ ...w, text: mask(w.text) })),
    utterances: transcription.utterances.map((u) => ({
      ...u,
      speakerName: mask(u.speakerName),
      text: mask(u.text),
      words: u.words.map((w) => ({ ...w, text: mask(w.text) })),
    })),
  };
}
