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
    const managed = { type: 'PROFANITY', inputAction: 'NONE' };
    const regex = { name: '社員番号', pattern: 'E[0-9]{6}', action: 'NONE' };
    const current = minimal();
    const input = new GuardrailUpdateInput({
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
    }).withStandardGrounding();

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
    const input = new GuardrailUpdateInput({
      ...minimal(),
      contentPolicy: { filters: [{ type: 'HATE' }] },
      topicPolicy: { topics: [{ name: '投資' }] },
    }).withStandardGrounding();
    expect(input.contentPolicyConfig).toEqual({
      filtersConfig: [{ type: 'HATE' }],
    });
    expect(input.topicPolicyConfig).toEqual({
      topicsConfig: [{ name: '投資' }],
    });
  });

  it('一覧がどれも空の単語・機密情報のポリシーは、項目ごと書かない', () => {
    const input = new GuardrailUpdateInput({
      ...minimal(),
      wordPolicy: { words: [], managedWordLists: [] },
      sensitiveInformationPolicy: {},
    }).withStandardGrounding();
    expect(input).not.toHaveProperty('wordPolicyConfig');
    expect(input).not.toHaveProperty('sensitiveInformationPolicyConfig');
  });

  it('ガードレールプロファイルの ID がなく ARN だけがあるときは、ARN を使う', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0';
    const input = new GuardrailUpdateInput({
      ...minimal(),
      crossRegionDetails: { guardrailProfileArn: arn },
    }).withStandardGrounding();
    expect(input.crossRegionConfig).toEqual({
      guardrailProfileIdentifier: arn,
    });
  });

  it('根拠の確認の tier（Standard に変えた後の get-guardrail が返す）があっても止めない', () => {
    const current = minimal();
    const input = new GuardrailUpdateInput({
      ...current,
      contextualGroundingPolicy: {
        ...current.contextualGroundingPolicy!,
        tier: { tierName: 'STANDARD' },
      },
    }).withStandardGrounding();
    expect(input.contextualGroundingPolicyConfig.tierConfig).toEqual({
      tierName: 'STANDARD',
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

  it('根拠の確認が設定されていなければ止める', () => {
    const current = minimal();
    delete current.contextualGroundingPolicy;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('根拠の確認（contextualGroundingPolicy）が設定されていません');
  });

  it('ガードレールプロファイルがなければ止める（STANDARD に必要なため）', () => {
    const current = minimal();
    delete current.crossRegionDetails;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('ガードレールプロファイル');
  });

  it('引き継ぎ方がわからない設定があれば止める（書かずに消してしまわないため）', () => {
    const current = {
      ...minimal(),
      automatedReasoningPolicy: { policies: ['p1'] },
    } as GetGuardrailResult;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('automatedReasoningPolicy');
  });

  it('ポリシーの中に引き継ぎ方がわからない項目があっても止める', () => {
    const current = {
      ...minimal(),
      contentPolicy: { filters: [{ type: 'HATE' }], newOption: true },
    } as GetGuardrailResult;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('contentPolicy.newOption');
  });

  it('根拠の確認のフィルターが空なら止める', () => {
    const current = {
      ...minimal(),
      contextualGroundingPolicy: { filters: [] },
    };
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('根拠の確認（contextualGroundingPolicy）が設定されていません');
  });

  it('今の根拠の確認の tier が CLASSIC でも、STANDARD に置き換える', () => {
    const current = minimal();
    const input = new GuardrailUpdateInput({
      ...current,
      contextualGroundingPolicy: {
        ...current.contextualGroundingPolicy!,
        tier: { tierName: 'CLASSIC' },
      },
    }).withStandardGrounding();
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
    const current = { ...minimal(), [policy]: value } as GetGuardrailResult;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow(`${policy}.extra`);
  });

  it('トピック・コンテンツフィルターの一覧が空なら、項目ごと書かない', () => {
    const input = new GuardrailUpdateInput({
      ...minimal(),
      topicPolicy: { topics: [], tier: { tierName: 'CLASSIC' } },
      contentPolicy: { filters: [] },
    }).withStandardGrounding();
    expect(input).not.toHaveProperty('topicPolicyConfig');
    expect(input).not.toHaveProperty('contentPolicyConfig');
  });

  it('根拠の確認にフィルターの一覧がなければ止める', () => {
    const current = {
      ...minimal(),
      contextualGroundingPolicy: {},
    } as GetGuardrailResult;
    expect(() =>
      new GuardrailUpdateInput(current).withStandardGrounding(),
    ).toThrow('根拠の確認（contextualGroundingPolicy）が設定されていません');
  });

  it('ガードレールプロファイルの ID が空の文字列なら、ARN を使う', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail-profile/apac.guardrail.v1:0';
    const input = new GuardrailUpdateInput({
      ...minimal(),
      crossRegionDetails: { guardrailProfileId: '', guardrailProfileArn: arn },
    }).withStandardGrounding();
    expect(input.crossRegionConfig).toEqual({
      guardrailProfileIdentifier: arn,
    });
  });

  it('番号付きのバージョンの get-guardrail の出力では止める（update-guardrail が書き換える DRAFT を、古い設定で上書きしないため）', () => {
    expect(() =>
      new GuardrailUpdateInput({
        ...minimal(),
        version: '1',
      }).withStandardGrounding(),
    ).toThrow('DRAFT');
  });
});
