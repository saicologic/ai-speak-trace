/**
 * AI 分析（Claude と Amazon Bedrock Guardrails）を使うか
 * - 設定画面で ON/OFF を保存すると、AI_ANALYSIS に on / off が入る（OFF のときは Claude も Guardrails も呼ばない）
 * - 一度も保存していない場合は、Anthropic の API キーと Guardrail ID の両方があれば使う
 *   （以前のバージョンから更新したときに、使えていた機能が使えなくならないように）
 */
export function isAiAnalysisEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.AI_ANALYSIS === 'on') return true;
  if (env.AI_ANALYSIS === 'off') return false;
  return Boolean(
    env.ANTHROPIC_API_KEY?.trim() && env.BEDROCK_GUARDRAIL_ID?.trim(),
  );
}
