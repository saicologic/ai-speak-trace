import { GuardrailFindings } from '../privacy/guardrail.service';
import { isReviewType, piiLabel } from '../privacy/privacy.utils';
import { EthicsCheck, ReportSegment } from './types/research.types';

/**
 * Guardrails の根拠スコアのしきい値
 * 66件の主張（正しい主張・事実を1か所変えた主張）での検証で、0.8 が最も正解率が高かった（98%）
 */
export const GROUNDING_THRESHOLD = 0.8;

/** Guardrails の根拠の確認に渡す根拠の文字数の上限（50 テキストユニット） */
const GROUNDING_SOURCE_MAX_CHARS = 50_000;

/**
 * 英語の主張か（Guardrails の根拠の確認は英語のみ対応のため）
 * 英字が 20 文字以上あり、英字が日本語の文字より十分に多いものを英語とみなす
 */
export function isEnglishText(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const japanese = (text.match(/[぀-ヿ㐀-鿿]/g) ?? []).length;
  return latin >= 20 && latin >= japanese * 4;
}

/** 根拠の確認の対象（英語で、Web の根拠が付いた文）と、Guardrails に渡す内容 */
export function groundingTarget(
  segment: ReportSegment,
): { source: string; query: string; claim: string } | null {
  const claim = segment.text.trim();
  const sources = segment.citations
    .filter((c) => c.sourceKind === 'web')
    .map((c) => c.citedText.trim())
    .filter(Boolean);
  if (sources.length === 0 || !isEnglishText(claim)) return null;
  return {
    source: sources.join('\n\n').slice(0, GROUNDING_SOURCE_MAX_CHARS),
    // 質問は主張そのものにする（主張と関係のない一般的な質問だと、関連度が下がって点数が不安定になる）
    query: claim.slice(0, 1000),
    claim: claim.slice(0, 5000),
  };
}

/**
 * 日本語の文に混ざった英語の部分を、1行ずつに分けて取り出す
 * Guardrails の単語フィルターは、日本語の中に空白なしで書かれた英単語を検出しないため
 */
export function extractEnglish(text: string): string {
  return (
    text.match(/[A-Za-z][A-Za-z0-9'’-]*(?:[ \t]+[A-Za-z0-9'’-]+)*/g) ?? []
  ).join('\n');
}

const CONTENT_LABELS: Record<string, string> = {
  HATE: 'ヘイト',
  INSULTS: '侮辱',
  SEXUAL: '性的な表現',
  VIOLENCE: '暴力',
  MISCONDUCT: '不正行為',
  PROMPT_ATTACK: 'プロンプト攻撃',
};

/** Guardrails の検出結果を、⑤ 評価の AI倫理のチェック項目にする */
export function toOutputChecks(
  findings: GuardrailFindings,
  englishWords: string[],
): EthicsCheck[] {
  const contact = [
    ...new Set(
      findings.pii
        .filter((p) => !isReviewType(p.type))
        .map((p) => piiLabel(p.type)),
    ),
  ];
  const candidates = findings.pii.filter((p) => isReviewType(p.type)).length;
  const content = findings.content.filter(
    (c) => c.confidence === 'MEDIUM' || c.confidence === 'HIGH',
  );
  const words = [...new Set([...findings.words, ...englishWords])];
  return [
    {
      item: '連絡先などの個人情報が含まれていない（Guardrails）',
      passed: contact.length === 0,
      detail:
        (contact.length === 0
          ? '電話番号・メールアドレスなどは検出されませんでした'
          : `検出: ${contact.join('、')}`) +
        (candidates > 0
          ? `。氏名などの候補 ${candidates}件は、製品名や公開されている人の名前も含むため判定に使っていません`
          : ''),
    },
    {
      item: '不適切な表現が含まれていない（Guardrails）',
      passed: content.length === 0,
      detail:
        content.length === 0
          ? '検出されませんでした'
          : `検出: ${content
              .map(
                (c) => `${CONTENT_LABELS[c.type] ?? c.type}（${c.confidence}）`,
              )
              .join('、')}`,
    },
    {
      item: '不適切な語が含まれていない（Guardrails の単語フィルター）',
      passed: words.length === 0,
      detail:
        words.length === 0
          ? '検出されませんでした'
          : `検出: ${words.join('、')}`,
    },
  ];
}
