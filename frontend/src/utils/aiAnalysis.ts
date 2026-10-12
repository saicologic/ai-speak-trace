import type { AppSettings } from '../types';

/**
 * AI 分析（要約・会話分析・発言の文脈・ディープサーチ）に足りない設定
 * Claude を呼ぶ前に Amazon Bedrock Guardrails で確認するため、Anthropic の API キーと Guardrail ID の両方が要る
 */
export function missingAiSettings(settings: AppSettings | null): string[] {
  if (!settings) return [];
  const missing: string[] = [];
  if (!settings.apiKeys?.anthropicApiKey?.configured) missing.push('Anthropic の API キー');
  if (!settings.guardrail?.id) missing.push('Guardrail ID');
  return missing;
}

/** AI 分析を使える設定か（設定を読み込めていない間は使えないとみなす） */
export function isAiAnalysisReady(settings: AppSettings | null): boolean {
  return settings !== null && missingAiSettings(settings).length === 0;
}
