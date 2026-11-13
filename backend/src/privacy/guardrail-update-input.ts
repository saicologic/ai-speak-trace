/** フィルター・トピック・単語などの1件（get-guardrail と update-guardrail で同じ形） */
type PolicyItem = Record<string, unknown>;

type TierName = 'CLASSIC' | 'STANDARD';

/** get-guardrail の出力（使う項目だけ） */
export interface GetGuardrailResult {
  name: string;
  guardrailId: string;
  guardrailArn?: string;
  version?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  description?: string;
  kmsKeyArn?: string;
  blockedInputMessaging: string;
  blockedOutputsMessaging: string;
  topicPolicy?: { topics: PolicyItem[]; tier?: { tierName: TierName } };
  contentPolicy?: { filters: PolicyItem[]; tier?: { tierName: TierName } };
  wordPolicy?: { words?: PolicyItem[]; managedWordLists?: PolicyItem[] };
  sensitiveInformationPolicy?: {
    piiEntities?: PolicyItem[];
    regexes?: PolicyItem[];
  };
  contextualGroundingPolicy?: {
    filters: PolicyItem[];
    tier?: { tierName: TierName };
  };
  crossRegionDetails?: {
    guardrailProfileId?: string;
    guardrailProfileArn?: string;
  };
}

/** update-guardrail の入力（作る項目だけ） */
export interface UpdateGuardrailInput {
  guardrailIdentifier: string;
  name: string;
  description?: string;
  kmsKeyId?: string;
  blockedInputMessaging: string;
  blockedOutputsMessaging: string;
  topicPolicyConfig?: {
    topicsConfig: PolicyItem[];
    tierConfig?: { tierName: TierName };
  };
  contentPolicyConfig?: {
    filtersConfig: PolicyItem[];
    tierConfig?: { tierName: TierName };
  };
  wordPolicyConfig?: {
    wordsConfig?: PolicyItem[];
    managedWordListsConfig?: PolicyItem[];
  };
  sensitiveInformationPolicyConfig?: {
    piiEntitiesConfig?: PolicyItem[];
    regexesConfig?: PolicyItem[];
  };
  contextualGroundingPolicyConfig: {
    filtersConfig: PolicyItem[];
    tierConfig: { tierName: 'STANDARD' };
  };
  crossRegionConfig: { guardrailProfileIdentifier: string };
}

/** 引き継ぎ方がわかっている get-guardrail の項目（ほかの項目があれば、書かずに消してしまわないよう止める） */
const KNOWN_FIELDS = new Set<string>([
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

/** 引き継ぎ方がわからない項目の名前（ポリシーの中は「ポリシー.項目」） */
function unknownFields(g: GetGuardrailResult): string[] {
  const record = g as unknown as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !KNOWN_FIELDS.has(k));
  for (const [policy, fields] of Object.entries(KNOWN_POLICY_FIELDS)) {
    const value = record[policy];
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(value)) {
      if (!fields.includes(key)) unknown.push(`${policy}.${key}`);
    }
  }
  return unknown.sort();
}

/** 空でない一覧だけをまとめ、どれも空なら undefined を返す（update-guardrail は空の一覧を受け付けないため） */
function nonEmptyLists<K extends string>(
  lists: Record<K, PolicyItem[] | undefined>,
): Partial<Record<K, PolicyItem[]>> | undefined {
  const entries = Object.entries(lists).filter(
    (e): e is [string, PolicyItem[]] => Array.isArray(e[1]) && e[1].length > 0,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Partial<Record<K, PolicyItem[]>>)
    : undefined;
}

/** tier が設定されていれば tierConfig にする */
function tierConfig(tier: { tierName: TierName } | undefined) {
  return tier ? { tierConfig: { tierName: tier.tierName } } : {};
}

/**
 * get-guardrail の出力から、update-guardrail の入力を作る
 * UpdateGuardrail は設定全体を置き換えるため、今の設定を引き継いだうえで変えたい所だけを変える
 */
export class GuardrailUpdateInput {
  constructor(private readonly current: GetGuardrailResult) {}

  /** 根拠の確認（contextual grounding check）の tier だけを STANDARD にした入力 */
  withStandardGrounding(): UpdateGuardrailInput {
    const g = this.current;
    const unknown = unknownFields(g);
    if (unknown.length > 0) {
      throw new Error(
        `引き継ぎ方がわからない設定があります: ${unknown.join(', ')}`,
      );
    }
    // update-guardrail が書き換えるのは DRAFT。番号付きのバージョンの設定で DRAFT を上書きしない
    if (g.version !== undefined && g.version !== 'DRAFT') {
      throw new Error(
        `DRAFT の get-guardrail の出力を渡してください（渡されたのはバージョン ${g.version}）`,
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
    const words = nonEmptyLists({
      wordsConfig: g.wordPolicy?.words,
      managedWordListsConfig: g.wordPolicy?.managedWordLists,
    });
    const sensitive = nonEmptyLists({
      piiEntitiesConfig: g.sensitiveInformationPolicy?.piiEntities,
      regexesConfig: g.sensitiveInformationPolicy?.regexes,
    });
    return {
      guardrailIdentifier: g.guardrailId,
      name: g.name,
      ...(g.description && { description: g.description }),
      ...(g.kmsKeyArn && { kmsKeyId: g.kmsKeyArn }),
      blockedInputMessaging: g.blockedInputMessaging,
      blockedOutputsMessaging: g.blockedOutputsMessaging,
      ...(g.topicPolicy?.topics?.length && {
        topicPolicyConfig: {
          topicsConfig: g.topicPolicy.topics,
          ...tierConfig(g.topicPolicy.tier),
        },
      }),
      ...(g.contentPolicy?.filters?.length && {
        contentPolicyConfig: {
          filtersConfig: g.contentPolicy.filters,
          ...tierConfig(g.contentPolicy.tier),
        },
      }),
      ...(words && { wordPolicyConfig: words }),
      ...(sensitive && { sensitiveInformationPolicyConfig: sensitive }),
      contextualGroundingPolicyConfig: {
        filtersConfig: grounding.filters,
        tierConfig: { tierName: 'STANDARD' },
      },
      crossRegionConfig: { guardrailProfileIdentifier: profile },
    };
  }
}
