import { isAiAnalysisReady, missingAiSettings } from './aiAnalysis';
import type { AppSettings } from '../types';

const settings = (anthropic: boolean, guardrailId: string): AppSettings =>
  ({
    apiKeys: {
      elevenlabsApiKey: { configured: true, last4: '' },
      anthropicApiKey: { configured: anthropic, last4: '' },
    },
    guardrail: { id: guardrailId, version: '' },
  }) as AppSettings;

describe('AI 分析の設定', () => {
  it('Anthropic の API キーと Guardrail ID の両方があれば使える', () => {
    expect(isAiAnalysisReady(settings(true, 'gr-1'))).toBe(true);
    expect(missingAiSettings(settings(true, 'gr-1'))).toEqual([]);
  });

  it('足りない設定を返す', () => {
    expect(missingAiSettings(settings(false, ''))).toEqual(['Anthropic の API キー', 'Guardrail ID']);
    expect(isAiAnalysisReady(settings(true, ''))).toBe(false);
    expect(isAiAnalysisReady(settings(false, 'gr-1'))).toBe(false);
  });

  it('設定を読み込めていない間は使えないとみなす', () => {
    expect(isAiAnalysisReady(null)).toBe(false);
  });
});
