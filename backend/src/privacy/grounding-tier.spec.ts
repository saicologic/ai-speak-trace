import type { GetGuardrailCommandOutput } from '@aws-sdk/client-bedrock';
import { groundingTierOf } from './grounding-tier';

/** GetGuardrail の結果の最小限の形（根拠の確認とクロスリージョン推論だけ） */
const guardrail = (
  overrides: Partial<GetGuardrailCommandOutput> = {},
): GetGuardrailCommandOutput => ({
  $metadata: {},
  name: 'research-verify',
  guardrailId: 'g1',
  guardrailArn: 'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail/g1',
  version: 'DRAFT',
  status: 'READY',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
  blockedInputMessaging: '入力を止めました',
  blockedOutputsMessaging: '出力を止めました',
  contextualGroundingPolicy: {
    filters: [
      { type: 'GROUNDING', threshold: 0.8, action: 'NONE', inputEnabled: true },
    ],
  },
  crossRegionDetails: {
    guardrailProfileId: 'apac.guardrail.v1:0',
    guardrailProfileArn:
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0',
  },
  ...overrides,
});

describe('groundingTierOf', () => {
  it('根拠の確認の tier が STANDARD なら STANDARD', () => {
    expect(
      groundingTierOf(
        guardrail({
          contextualGroundingPolicy: {
            filters: [{ type: 'GROUNDING', threshold: 0.8 }],
            tier: { tierName: 'STANDARD' },
          },
        }),
      ),
    ).toBe('STANDARD');
  });

  it('tier が CLASSIC か、tier がなければ CLASSIC（tier を書かなければ Classic になるため）', () => {
    expect(
      groundingTierOf(
        guardrail({
          contextualGroundingPolicy: {
            filters: [{ type: 'GROUNDING', threshold: 0.8 }],
            tier: { tierName: 'CLASSIC' },
          },
        }),
      ),
    ).toBe('CLASSIC');
    expect(groundingTierOf(guardrail())).toBe('CLASSIC');
  });

  it('根拠の確認が設定されていない（フィルターがない）なら NONE', () => {
    expect(
      groundingTierOf(guardrail({ contextualGroundingPolicy: undefined })),
    ).toBe('NONE');
    expect(
      groundingTierOf(
        guardrail({ contextualGroundingPolicy: { filters: [] } }),
      ),
    ).toBe('NONE');
  });
});
