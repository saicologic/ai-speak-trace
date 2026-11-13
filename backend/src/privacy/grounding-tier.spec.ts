import type { GetGuardrailCommandOutput } from '@aws-sdk/client-bedrock';
import {
  groundingTierOf,
  sameSettingsExceptGroundingTier,
  standardGroundingRequest,
} from './grounding-tier';

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
      { type: 'GROUNDING', threshold: 0.8, action: 'NONE', enabled: true },
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

describe('standardGroundingRequest', () => {
  it('根拠の確認の tier を STANDARD にし、根拠の確認のフィルターとガードレールプロファイルを引き継ぐ', () => {
    expect(standardGroundingRequest(guardrail())).toEqual({
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
    });
  });

  it('ほかの設定（コンテンツフィルターの tier・トピック・単語・機密情報・説明・KMS キー）を引き継ぎ、空の一覧は書かない', () => {
    const contentFilter = {
      type: 'PROMPT_ATTACK',
      inputStrength: 'MEDIUM',
      outputStrength: 'NONE',
      inputAction: 'NONE',
    } as const;
    const topic = {
      name: '投資',
      definition: '投資の助言',
      type: 'DENY',
    } as const;
    const word = { text: 'foo', inputAction: 'NONE' } as const;
    const managed = { type: 'PROFANITY', inputAction: 'NONE' } as const;
    const regex = {
      name: '社員番号',
      pattern: 'E[0-9]{6}',
      action: 'NONE',
    } as const;
    const current = guardrail();
    const input = standardGroundingRequest({
      ...current,
      description: '動作確認用',
      kmsKeyArn: 'arn:aws:kms:ap-northeast-1:000000000000:key/k1',
      contentPolicy: {
        filters: [contentFilter],
        tier: { tierName: 'STANDARD' },
      },
      topicPolicy: { topics: [topic], tier: { tierName: 'CLASSIC' } },
      wordPolicy: { words: [word], managedWordLists: [managed] },
      sensitiveInformationPolicy: { piiEntities: [], regexes: [regex] },
    });

    expect(input).toEqual({
      guardrailIdentifier: 'g1',
      name: 'research-verify',
      description: '動作確認用',
      kmsKeyId: 'arn:aws:kms:ap-northeast-1:000000000000:key/k1',
      blockedInputMessaging: '入力を止めました',
      blockedOutputsMessaging: '出力を止めました',
      contentPolicyConfig: {
        filtersConfig: [contentFilter],
        tierConfig: { tierName: 'STANDARD' },
      },
      topicPolicyConfig: {
        topicsConfig: [topic],
        tierConfig: { tierName: 'CLASSIC' },
      },
      wordPolicyConfig: {
        wordsConfig: [word],
        managedWordListsConfig: [managed],
      },
      // 空の一覧は書かない（update-guardrail は空の一覧を受け付けないため）
      sensitiveInformationPolicyConfig: { regexesConfig: [regex] },
      contextualGroundingPolicyConfig: {
        filtersConfig: current.contextualGroundingPolicy!.filters,
        tierConfig: { tierName: 'STANDARD' },
      },
      crossRegionConfig: { guardrailProfileIdentifier: 'apac.guardrail.v1:0' },
    });
  });

  it('tier のないポリシーには tierConfig を書かない', () => {
    const input = standardGroundingRequest({
      ...guardrail(),
      contentPolicy: { filters: [{ type: 'HATE' }] } as never,
      topicPolicy: { topics: [{ name: '投資' }] } as never,
    });
    expect(input.contentPolicyConfig).toEqual({
      filtersConfig: [{ type: 'HATE' }],
    });
    expect(input.topicPolicyConfig).toEqual({
      topicsConfig: [{ name: '投資' }],
    });
  });

  it('一覧がどれも空の単語・機密情報のポリシーは、項目ごと書かない', () => {
    const input = standardGroundingRequest({
      ...guardrail(),
      wordPolicy: { words: [], managedWordLists: [] },
      sensitiveInformationPolicy: {},
    });
    expect(input).not.toHaveProperty('wordPolicyConfig');
    expect(input).not.toHaveProperty('sensitiveInformationPolicyConfig');
  });

  it('ガードレールプロファイルの ID がなく ARN だけがあるときは、ARN を使う', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0';
    const input = standardGroundingRequest({
      ...guardrail(),
      crossRegionDetails: { guardrailProfileArn: arn },
    });
    expect(input.crossRegionConfig).toEqual({
      guardrailProfileIdentifier: arn,
    });
  });

  it('根拠の確認の tier（Standard に変えた後の get-guardrail が返す）があっても止めない', () => {
    const current = guardrail();
    const input = standardGroundingRequest({
      ...current,
      contextualGroundingPolicy: {
        ...current.contextualGroundingPolicy!,
        tier: { tierName: 'STANDARD' },
      },
    });
    expect(input.contextualGroundingPolicyConfig.tierConfig).toEqual({
      tierName: 'STANDARD',
    });
  });

  it('設定されていない項目は書かない', () => {
    const input = standardGroundingRequest(guardrail());
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

  it('根拠の確認が設定されていなければ止める', () => {
    const current = guardrail();
    delete current.contextualGroundingPolicy;
    expect(() => standardGroundingRequest(current)).toThrow(
      '根拠の確認（contextualGroundingPolicy）が設定されていません',
    );
  });

  it('ガードレールプロファイルがなければ止める（STANDARD に必要なため）', () => {
    const current = guardrail();
    delete current.crossRegionDetails;
    expect(() => standardGroundingRequest(current)).toThrow(
      'ガードレールプロファイル',
    );
  });

  it('引き継ぎ方がわからない設定があれば止める（書かずに消してしまわないため）', () => {
    const current = {
      ...guardrail(),
      automatedReasoningPolicy: { policies: ['p1'] },
    } as unknown as GetGuardrailCommandOutput;
    expect(() => standardGroundingRequest(current)).toThrow(
      'automatedReasoningPolicy',
    );
  });

  it('ポリシーの中に引き継ぎ方がわからない項目があっても止める', () => {
    const current = {
      ...guardrail(),
      contentPolicy: { filters: [{ type: 'HATE' }], newOption: true },
    } as unknown as GetGuardrailCommandOutput;
    expect(() => standardGroundingRequest(current)).toThrow(
      'contentPolicy.newOption',
    );
  });

  it('根拠の確認のフィルターが空なら止める', () => {
    const current = {
      ...guardrail(),
      contextualGroundingPolicy: { filters: [] },
    };
    expect(() => standardGroundingRequest(current)).toThrow(
      '根拠の確認（contextualGroundingPolicy）が設定されていません',
    );
  });

  it('今の根拠の確認の tier が CLASSIC でも、STANDARD に置き換える', () => {
    const current = guardrail();
    const input = standardGroundingRequest({
      ...current,
      contextualGroundingPolicy: {
        ...current.contextualGroundingPolicy!,
        tier: { tierName: 'CLASSIC' },
      },
    });
    expect(input.contextualGroundingPolicyConfig.tierConfig).toEqual({
      tierName: 'STANDARD',
    });
  });

  it.each([
    ['topicPolicy', { topics: [{ name: '投資' }], extra: 1 }],
    ['wordPolicy', { words: [{ text: 'foo' }], extra: 1 }],
    [
      'sensitiveInformationPolicy',
      { piiEntities: [{ type: 'EMAIL' }], extra: 1 },
    ],
    [
      'contextualGroundingPolicy',
      { filters: [{ type: 'GROUNDING', threshold: 0.8 }], extra: 1 },
    ],
    [
      'crossRegionDetails',
      { guardrailProfileId: 'apac.guardrail.v1:0', extra: 1 },
    ],
  ])('%s の中に引き継ぎ方がわからない項目があれば止める', (policy, value) => {
    const current = {
      ...guardrail(),
      [policy]: value,
    } as unknown as GetGuardrailCommandOutput;
    expect(() => standardGroundingRequest(current)).toThrow(`${policy}.extra`);
  });

  it('トピック・コンテンツフィルターの一覧が空なら、項目ごと書かない', () => {
    const input = standardGroundingRequest({
      ...guardrail(),
      topicPolicy: { topics: [], tier: { tierName: 'CLASSIC' } },
      contentPolicy: { filters: [] },
    });
    expect(input).not.toHaveProperty('topicPolicyConfig');
    expect(input).not.toHaveProperty('contentPolicyConfig');
  });

  it('根拠の確認にフィルターの一覧がなければ止める', () => {
    const current = {
      ...guardrail(),
      contextualGroundingPolicy: {},
    } as unknown as GetGuardrailCommandOutput;
    expect(() => standardGroundingRequest(current)).toThrow(
      '根拠の確認（contextualGroundingPolicy）が設定されていません',
    );
  });

  it('ガードレールプロファイルの ID が空の文字列なら、ARN を使う', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0';
    const input = standardGroundingRequest({
      ...guardrail(),
      crossRegionDetails: { guardrailProfileId: '', guardrailProfileArn: arn },
    });
    expect(input.crossRegionConfig).toEqual({
      guardrailProfileIdentifier: arn,
    });
  });

  it('番号付きのバージョンの get-guardrail の出力では止める（update-guardrail が書き換える DRAFT を、古い設定で上書きしないため）', () => {
    expect(() =>
      standardGroundingRequest({
        ...guardrail(),
        version: '1',
      }),
    ).toThrow('DRAFT');
  });

  it('version がない get-guardrail の出力では止めない', () => {
    const current = guardrail({ version: undefined });
    expect(
      standardGroundingRequest(current).contextualGroundingPolicyConfig
        .tierConfig,
    ).toEqual({ tierName: 'STANDARD' });
  });
});

describe('sameSettingsExceptGroundingTier', () => {
  it('バージョン・日時・状態・根拠の確認の tier だけが違うなら、同じ設定とみなす', () => {
    const draft = guardrail({
      contextualGroundingPolicy: {
        filters: [{ type: 'GROUNDING', threshold: 0.8, action: 'NONE' }],
        tier: { tierName: 'CLASSIC' },
      },
    });
    const pinned = guardrail({
      version: '3',
      status: 'READY',
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      contextualGroundingPolicy: {
        filters: [{ type: 'GROUNDING', threshold: 0.8, action: 'NONE' }],
      },
    });
    expect(sameSettingsExceptGroundingTier(draft, pinned)).toBe(true);
  });

  it('根拠の確認のしきい値が違えば、違う設定とみなす', () => {
    const pinned = guardrail({
      version: '3',
      contextualGroundingPolicy: {
        filters: [{ type: 'GROUNDING', threshold: 0.5, action: 'NONE' }],
      },
    });
    expect(sameSettingsExceptGroundingTier(guardrail(), pinned)).toBe(false);
  });

  it('ほかのポリシー（コンテンツフィルター）が違えば、違う設定とみなす', () => {
    const pinned = guardrail({
      version: '3',
      contentPolicy: {
        filters: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        ],
      },
    });
    expect(sameSettingsExceptGroundingTier(guardrail(), pinned)).toBe(false);
  });

  it('ガードレールプロファイルの ARN が違えば、違う設定とみなす', () => {
    const arn = (name: string) =>
      `arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/${name}`;
    const a = guardrail({
      crossRegionDetails: { guardrailProfileArn: arn('apac.guardrail.v1:0') },
    });
    const b = guardrail({
      version: '3',
      crossRegionDetails: { guardrailProfileArn: arn('us.guardrail.v1:0') },
    });
    expect(sameSettingsExceptGroundingTier(a, b)).toBe(false);
  });

  it('キーの順番が違うだけなら、同じ設定とみなす', () => {
    const a = guardrail({
      contentPolicy: {
        filters: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'LOW' },
        ],
      },
    });
    const b = guardrail({
      contentPolicy: {
        filters: [
          { outputStrength: 'LOW', type: 'HATE', inputStrength: 'HIGH' },
        ],
      },
    });
    expect(sameSettingsExceptGroundingTier(a, b)).toBe(true);
  });
});
