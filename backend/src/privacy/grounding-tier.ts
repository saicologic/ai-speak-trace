import type {
  GetGuardrailCommandOutput,
  GuardrailContentFilterConfig,
  GuardrailContextualGroundingFilterConfig,
  GuardrailContextualGroundingPolicyConfig,
  GuardrailCrossRegionConfig,
  GuardrailSensitiveInformationPolicyConfig,
  GuardrailTopicConfig,
  GuardrailWordPolicyConfig,
  UpdateGuardrailCommandInput,
} from '@aws-sdk/client-bedrock';

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

/** UpdateGuardrail の入力のうち、根拠の確認とクロスリージョン推論を必ず持つもの */
export type StandardGroundingRequest = UpdateGuardrailCommandInput & {
  contextualGroundingPolicyConfig: GuardrailContextualGroundingPolicyConfig;
  crossRegionConfig: GuardrailCrossRegionConfig;
};

/** 引き継ぎ方がわかっている GetGuardrail の項目（ほかの項目があれば、書かずに消してしまわないよう止める） */
const KNOWN_FIELDS = new Set<string>([
  '$metadata',
  'name',
  'guardrailId',
  'guardrailArn',
  'version',
  'status',
  'statusReasons',
  'failureRecommendations',
  'createdAt',
  'updatedAt',
  'description',
  'kmsKeyArn',
  'blockedInputMessaging',
  'blockedOutputsMessaging',
  'topicPolicy',
  'contentPolicy',
  'wordPolicy',
  'sensitiveInformationPolicy',
  'contextualGroundingPolicy',
  'crossRegionDetails',
]);

/** ポリシーの中の、引き継ぎ方がわかっている項目 */
const KNOWN_POLICY_FIELDS: Record<string, string[]> = {
  topicPolicy: ['topics', 'tier'],
  contentPolicy: ['filters', 'tier'],
  wordPolicy: ['words', 'managedWordLists'],
  sensitiveInformationPolicy: ['piiEntities', 'regexes'],
  // tier は書き換えるため、今の値は使わない
  contextualGroundingPolicy: ['filters', 'tier'],
  crossRegionDetails: ['guardrailProfileId', 'guardrailProfileArn'],
};

/** 引き継ぎ方がわからない項目の名前（ポリシーの中は「ポリシー.項目」。値が undefined の項目は数えない） */
export function unknownFields(g: GetGuardrailCommandOutput): string[] {
  const record = g as unknown as Record<string, unknown>;
  const present = (o: Record<string, unknown>) =>
    Object.keys(o).filter((k) => o[k] !== undefined);
  const unknown = present(record).filter((k) => !KNOWN_FIELDS.has(k));
  for (const [policy, fields] of Object.entries(KNOWN_POLICY_FIELDS)) {
    const value = record[policy];
    if (!value || typeof value !== 'object') continue;
    for (const key of present(value as Record<string, unknown>)) {
      if (!fields.includes(key)) unknown.push(`${policy}.${key}`);
    }
  }
  return unknown.sort();
}

/** 空でない一覧だけをまとめ、どれも空なら undefined を返す（UpdateGuardrail は空の一覧を受け付けないため） */
function nonEmptyLists<T>(
  lists: Record<string, unknown[] | undefined>,
): T | undefined {
  const entries = Object.entries(lists).filter(
    (e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].length > 0,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * GetGuardrail（DRAFT）の結果から、根拠の確認の tier だけを STANDARD にした UpdateGuardrail の入力を作る
 * UpdateGuardrail は設定全体を置き換えるため、今の設定を引き継いだうえで tier だけを変える
 */
export function standardGroundingRequest(
  g: GetGuardrailCommandOutput,
): StandardGroundingRequest {
  const unknown = unknownFields(g);
  if (unknown.length > 0) {
    throw new Error(
      `引き継ぎ方がわからない設定があります: ${unknown.join(', ')}`,
    );
  }
  // UpdateGuardrail が書き換えるのは DRAFT。番号付きのバージョンの設定で DRAFT を上書きしない
  if (g.version !== undefined && g.version !== 'DRAFT') {
    throw new Error(
      `DRAFT の設定を渡してください（渡されたのはバージョン ${g.version}）`,
    );
  }
  const grounding = g.contextualGroundingPolicy;
  if (!grounding?.filters?.length) {
    throw new Error(
      '根拠の確認（contextualGroundingPolicy）が設定されていません',
    );
  }
  // guardrailProfileIdentifier は ID と ARN のどちらでもよい
  const profile =
    g.crossRegionDetails?.guardrailProfileId ||
    g.crossRegionDetails?.guardrailProfileArn;
  if (!profile) {
    throw new Error(
      'クロスリージョン推論（ガードレールプロファイル）が設定されていません。STANDARD に必要です',
    );
  }
  const words = nonEmptyLists<GuardrailWordPolicyConfig>({
    wordsConfig: g.wordPolicy?.words,
    managedWordListsConfig: g.wordPolicy?.managedWordLists,
  });
  const sensitive = nonEmptyLists<GuardrailSensitiveInformationPolicyConfig>({
    piiEntitiesConfig: g.sensitiveInformationPolicy?.piiEntities,
    regexesConfig: g.sensitiveInformationPolicy?.regexes,
  });
  const topics = g.topicPolicy?.topics;
  const filters = g.contentPolicy?.filters;
  return {
    guardrailIdentifier: g.guardrailId,
    name: g.name,
    ...(g.description && { description: g.description }),
    ...(g.kmsKeyArn && { kmsKeyId: g.kmsKeyArn }),
    blockedInputMessaging: g.blockedInputMessaging,
    blockedOutputsMessaging: g.blockedOutputsMessaging,
    // GetGuardrail と UpdateGuardrail は、フィルター・トピックの1件の形が同じ（SDK 3.1168.0 で確かめた）。
    // 1件の中の項目は確かめずに渡すため、SDK を上げるときは、1件の形が変わっていないかを確かめる
    ...(topics?.length && {
      topicPolicyConfig: {
        topicsConfig: topics as GuardrailTopicConfig[],
        ...(g.topicPolicy?.tier && {
          tierConfig: { tierName: g.topicPolicy.tier.tierName },
        }),
      },
    }),
    ...(filters?.length && {
      contentPolicyConfig: {
        filtersConfig: filters as GuardrailContentFilterConfig[],
        ...(g.contentPolicy?.tier && {
          tierConfig: { tierName: g.contentPolicy.tier.tierName },
        }),
      },
    }),
    ...(words && { wordPolicyConfig: words }),
    ...(sensitive && { sensitiveInformationPolicyConfig: sensitive }),
    contextualGroundingPolicyConfig: {
      filtersConfig:
        grounding.filters as GuardrailContextualGroundingFilterConfig[],
      tierConfig: { tierName: 'STANDARD' },
    },
    crossRegionConfig: { guardrailProfileIdentifier: profile },
  };
}

/** キーの順番をそろえた JSON（設定を比べるため） */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : v,
  );
}

/** 比べる設定（バージョン・日時・状態と、根拠の確認の tier を除く） */
function comparableSettings(g: GetGuardrailCommandOutput): unknown {
  // description はバージョンごとの説明なので比べない（新しいバージョンには切り替えの説明を付けるため）
  return {
    name: g.name,
    kmsKeyArn: g.kmsKeyArn,
    blockedInputMessaging: g.blockedInputMessaging,
    blockedOutputsMessaging: g.blockedOutputsMessaging,
    topicPolicy: g.topicPolicy,
    contentPolicy: g.contentPolicy,
    wordPolicy: g.wordPolicy,
    sensitiveInformationPolicy: g.sensitiveInformationPolicy,
    groundingFilters: g.contextualGroundingPolicy?.filters,
    guardrailProfileId: g.crossRegionDetails?.guardrailProfileId,
    guardrailProfileArn: g.crossRegionDetails?.guardrailProfileArn,
  };
}

/**
 * 2つの設定が、根拠の確認の tier 以外で同じか
 * 番号付きのバージョンを使っているとき、DRAFT から新しいバージョンを作っても、tier のほかは変わらないことを確かめるため
 */
export function sameSettingsExceptGroundingTier(
  a: GetGuardrailCommandOutput,
  b: GetGuardrailCommandOutput,
): boolean {
  return (
    canonicalJson(comparableSettings(a)) ===
    canonicalJson(comparableSettings(b))
  );
}
