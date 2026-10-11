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

/**
 * 誤検出が多い種類（製品名・会社名・国名・公開されている人の名前なども検出される）
 * 初期状態では伏せずに「要確認」にし、利用者に選んでもらう
 */
const REVIEW_TYPES = new Set(['NAME', 'USERNAME', 'ADDRESS', 'AGE']);

/** 誤検出が多い種類か（氏名・ユーザー名・住所・年齢） */
export function isReviewType(type: string): boolean {
  return REVIEW_TYPES.has(type);
}

/**
 * 国名（国名だけの「住所」は個人を特定しないため、個人情報として扱わない）
 * Guardrails の機密情報フィルターは、会話に出てくる国名を住所として検出することがある
 */
const COUNTRY_NAMES = new Set(
  [
    '日本',
    '日本国',
    'アメリカ',
    'アメリカ合衆国',
    '米国',
    'イギリス',
    '英国',
    '中国',
    '韓国',
    '台湾',
    'フランス',
    'ドイツ',
    'イタリア',
    'スペイン',
    'カナダ',
    'オーストラリア',
    'インド',
    'シンガポール',
    'ロシア',
    'ブラジル',
    'japan',
    'america',
    'united states',
    'usa',
    'us',
    'uk',
    'united kingdom',
    'china',
    'korea',
    'taiwan',
    'france',
    'germany',
    'canada',
    'australia',
    'india',
    'singapore',
  ].map((name) => name.toLowerCase()),
);

/**
 * 会社名・製品名・サービス名（個人の名前ではないため、氏名として扱わない）
 * Guardrails の氏名（NAME）は「個人の名前」で組織名を含まないが、会話に出てくる製品名などを
 * 氏名として検出することがある。人名と同じ表記になりにくい、技術の会話でよく出るものに限る
 */
const ORGANIZATION_AND_PRODUCT_NAMES = new Set(
  [
    'Claude',
    'Claude Code',
    'Claude Desktop',
    'Anthropic',
    'OpenAI',
    'ChatGPT',
    'GPT',
    'Codex',
    'Gemini',
    'Google',
    'Microsoft',
    'Copilot',
    'GitHub',
    'GitHub Copilot',
    'AWS',
    'Amazon',
    'Amazon Bedrock',
    'Bedrock',
    'Meta',
    'Llama',
    'LangChain',
    'LangGraph',
    'LangSmith',
    'Langfuse',
    'Cursor',
    'Grok',
    'Mistral',
    'Hugging Face',
    'NVIDIA',
    "O'Reilly",
    'Zenn',
    'Qiita',
  ].map(normalizeName),
);

/** 比べるための表記にそろえる（前後の空白・大文字小文字・アポストロフィの違いを無視する） */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[’‘`]/g, "'");
}

/**
 * 個人情報として扱わない検出か
 * - ユーザー名: 話した会話にログインIDなどが出ることはまずなく、製品名・会社名の誤検出になるため
 * - 国名だけの住所: 個人を特定しないため（番地や市区町村を含む住所はこれまでどおり扱う）
 * - 会社名・製品名だけの氏名: 個人の名前ではないため（一致するものだけ。公開されている人の名前は利用者が選ぶ）
 */
export function isIgnoredPii(type: string, match: string): boolean {
  if (type === 'USERNAME') return true;
  if (type === 'ADDRESS') {
    return COUNTRY_NAMES.has(match.trim().toLowerCase());
  }
  if (type === 'NAME') {
    return ORGANIZATION_AND_PRODUCT_NAMES.has(normalizeName(match));
  }
  return false;
}

/** 保存済みの検出結果から、個人情報として扱わないものを除く（利用者が「伏せる」を選んだものは残す） */
export function withoutIgnoredPii(findings: PiiFinding[]): PiiFinding[] {
  return findings.filter((f) => f.mask || !isIgnoredPii(f.type, f.text));
}

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
 * 前回のチェックで利用者が選んだ「伏せる／伏せない」は引き継ぐ。
 * 新しく見つかったものは、連絡先などは伏せ、誤検出の多い種類は伏せずに要確認にする
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
    const review = REVIEW_TYPES.has(type);
    byKey.set(key, {
      type,
      label: piiLabel(type),
      text: value,
      count: Math.max(countIn(text, value), 1),
      mask: before?.mask ?? !review,
      needsReview: before?.needsReview ?? review,
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
