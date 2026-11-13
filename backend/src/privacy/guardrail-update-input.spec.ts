import {
  GetGuardrailResult,
  GuardrailUpdateInput,
} from './guardrail-update-input';

/** get-guardrail の出力の最小限の形（根拠の確認とクロスリージョン推論だけ） */
const minimal = (): GetGuardrailResult => ({
  name: 'research-verify',
  guardrailId: 'g1',
  guardrailArn: 'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail/g1',
  version: 'DRAFT',
  status: 'READY',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z',
  blockedInputMessaging: '入力を止めました',
  blockedOutputsMessaging: '出力を止めました',
  contextualGroundingPolicy: {
    filters: [
      { type: 'GROUNDING', threshold: 0.8, action: 'NONE', enabled: true },
    ],
  },
  crossRegionDetails: {
    guardrailProfileId: 'apac.guardrail.v1:0',
    guardrailProfileArn:
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0',
  },
});

describe('GuardrailUpdateInput', () => {
  it('根拠の確認の tier を STANDARD にし、根拠の確認のフィルターとガードレールプロファイルを引き継ぐ', () => {
    expect(new GuardrailUpdateInput(minimal()).withStandardGrounding()).toEqual(
      {
        guardrailIdentifier: 'g1',
        name: 'research-verify',
        blockedInputMessaging: '入力を止めました',
        blockedOutputsMessaging: '出力を止めました',
        contextualGroundingPolicyConfig: {
          filtersConfig: [
            {
              type: 'GROUNDING',
              threshold: 0.8,
              action: 'NONE',
              enabled: true,
            },
          ],
          tierConfig: { tierName: 'STANDARD' },
        },
        crossRegionConfig: {
          guardrailProfileIdentifier: 'apac.guardrail.v1:0',
        },
      },
    );
  });
});
