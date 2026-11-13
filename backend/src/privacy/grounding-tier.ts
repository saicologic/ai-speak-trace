import type { GetGuardrailCommandOutput } from '@aws-sdk/client-bedrock';

/** 根拠の確認（contextual grounding check）の tier。NONE は根拠の確認が設定されていない */
export type GroundingTier = 'STANDARD' | 'CLASSIC' | 'NONE';

/** GetGuardrail の結果から、根拠の確認の tier を判定する（tier を書かずに作ると CLASSIC になる） */
export function groundingTierOf(
  guardrail: GetGuardrailCommandOutput,
): GroundingTier {
  const policy = guardrail.contextualGroundingPolicy;
  if (!policy?.filters?.length) return 'NONE';
  return policy.tier?.tierName === 'STANDARD' ? 'STANDARD' : 'CLASSIC';
}
