import { aiAnalysisState, isAiAnalysisReady, missingAiSettings } from './aiAnalysis';
import type { AppSettings } from '../types';

const settings = (anthropic: boolean, guardrailId: string, enabled = true): AppSettings =>
  ({
    apiKeys: {
      elevenlabsApiKey: { configured: true, last4: '' },
      anthropicApiKey: { configured: anthropic, last4: '' },
    },
    enableAiAnalysis: enabled,
    guardrail: { id: guardrailId, version: '' },
  }) as AppSettings;

describe('AI 分析の設定', () => {
  it('ON で、Anthropic の API キーと Guardrail ID の両方があれば使える', () => {
    expect(aiAnalysisState(settings(true, 'gr-1'))).toBe('ready');
    expect(isAiAnalysisReady(settings(true, 'gr-1'))).toBe(true);
    expect(missingAiSettings(settings(true, 'gr-1'))).toEqual([]);
  });

  it('OFF にしていれば、設定が済んでいても使えない', () => {
    expect(aiAnalysisState(settings(true, 'gr-1', false))).toBe('off');
    expect(isAiAnalysisReady(settings(true, 'gr-1', false))).toBe(false);
  });

  it('ON で設定が足りなければ、足りない設定を返す', () => {
    expect(aiAnalysisState(settings(true, ''))).toBe('missing');
    expect(missingAiSettings(settings(false, ''))).toEqual(['Anthropic の API キー', 'Guardrail ID']);
    expect(isAiAnalysisReady(settings(false, 'gr-1'))).toBe(false);
  });

  it('設定を読み込めていない間は使えないとみなす', () => {
    expect(aiAnalysisState(null)).toBe('loading');
    expect(isAiAnalysisReady(null)).toBe(false);
  });
});
