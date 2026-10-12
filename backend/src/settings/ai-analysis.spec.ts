import { isAiAnalysisEnabled } from './ai-analysis';

describe('isAiAnalysisEnabled', () => {
  const both = { ANTHROPIC_API_KEY: 'k', BEDROCK_GUARDRAIL_ID: 'gr-1' };

  it('保存した ON/OFF に従う（OFF なら設定が済んでいても使わない）', () => {
    expect(isAiAnalysisEnabled({ ...both, AI_ANALYSIS: 'off' })).toBe(false);
    expect(isAiAnalysisEnabled({ AI_ANALYSIS: 'on' })).toBe(true);
  });

  it('保存していない場合は、API キーと Guardrail ID の両方があれば使う', () => {
    expect(isAiAnalysisEnabled(both)).toBe(true);
    expect(isAiAnalysisEnabled({ ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(isAiAnalysisEnabled({})).toBe(false);
  });
});
