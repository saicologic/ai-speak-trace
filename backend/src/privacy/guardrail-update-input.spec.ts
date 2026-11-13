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

  it('ほかの設定（コンテンツフィルターの tier・トピック・単語・機密情報・説明・KMS キー）を引き継ぎ、空の一覧は書かない', () => {
    const contentFilter = {
      type: 'PROMPT_ATTACK',
      inputStrength: 'MEDIUM',
      outputStrength: 'NONE',
      inputAction: 'NONE',
    };
    const topic = { name: '投資', definition: '投資の助言', type: 'DENY' };
    const word = { text: 'foo', inputAction: 'NONE' };
    const pii = { type: 'EMAIL', action: 'NONE' };
    const input = new GuardrailUpdateInput({
      ...minimal(),
      description: '動作確認用',
      kmsKeyArn: 'arn:aws:kms:ap-northeast-1:000000000000:key/k1',
      contentPolicy: {
        filters: [contentFilter],
        tier: { tierName: 'STANDARD' },
      },
      topicPolicy: { topics: [topic], tier: { tierName: 'CLASSIC' } },
      wordPolicy: { words: [word], managedWordLists: [] },
      sensitiveInformationPolicy: { piiEntities: [pii], regexes: [] },
    }).withStandardGrounding();

    expect(input).toMatchObject({
      description: '動作確認用',
      kmsKeyId: 'arn:aws:kms:ap-northeast-1:000000000000:key/k1',
      contentPolicyConfig: {
        filtersConfig: [contentFilter],
        tierConfig: { tierName: 'STANDARD' },
      },
      topicPolicyConfig: {
        topicsConfig: [topic],
        tierConfig: { tierName: 'CLASSIC' },
      },
    });
    // 空の一覧は書かない（update-guardrail は空の一覧を受け付けないため）
    expect(input.wordPolicyConfig).toEqual({ wordsConfig: [word] });
    expect(input.sensitiveInformationPolicyConfig).toEqual({
      piiEntitiesConfig: [pii],
    });
  });

  it('設定されていない項目は書かない', () => {
    const input = new GuardrailUpdateInput(minimal()).withStandardGrounding();
    expect(Object.keys(input).sort()).toEqual(
      [
        'blockedInputMessaging',
        'blockedOutputsMessaging',
        'contextualGroundingPolicyConfig',
        'crossRegionConfig',
        'guardrailIdentifier',
        'name',
      ].sort(),
    );
  });
});
