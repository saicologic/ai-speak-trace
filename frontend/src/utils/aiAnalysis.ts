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

/**
 * AI 分析の状態
 * - ready: ON で、設定も済んでいる（ボタンを押せる）
 * - off: OFF にしている
 * - missing: ON だが、設定が足りない
 * - loading: 設定を読み込めていない
 */
export type AiAnalysisState = 'ready' | 'off' | 'missing' | 'loading';

export function aiAnalysisState(settings: AppSettings | null): AiAnalysisState {
  if (!settings) return 'loading';
  if (!settings.enableAiAnalysis) return 'off';
  return missingAiSettings(settings).length === 0 ? 'ready' : 'missing';
}

/** AI 分析のボタンを押せるか（設定を読み込めていない間は押せない） */
export function isAiAnalysisReady(settings: AppSettings | null): boolean {
  return aiAnalysisState(settings) === 'ready';
}
