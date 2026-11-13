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
  contextualGroundingPolicy?: { filters: PolicyItem[] };
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

/** 空でない一覧だけを、指定した名前で返す（update-guardrail は空の一覧を受け付けないため） */
function nonEmpty<K extends string>(
  key: K,
  items: PolicyItem[] | undefined,
): Partial<Record<K, PolicyItem[]>> {
  return items && items.length > 0
    ? ({ [key]: items } as Record<K, PolicyItem[]>)
    : {};
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
    const unknown = Object.keys(g).filter((k) => !KNOWN_FIELDS.has(k));
    if (unknown.length > 0) {
      throw new Error(
        `引き継ぎ方がわからない設定があります: ${unknown.sort().join(', ')}`,
      );
    }
    const grounding = g.contextualGroundingPolicy;
    if (!grounding) {
      throw new Error(
        '根拠の確認（contextualGroundingPolicy）が設定されていません',
      );
    }
    const profile = g.crossRegionDetails?.guardrailProfileId;
    if (!profile) {
      throw new Error(
        'クロスリージョン推論（ガードレールプロファイル）が設定されていません。STANDARD に必要です',
      );
    }
    return {
      guardrailIdentifier: g.guardrailId,
      name: g.name,
      ...(g.description && { description: g.description }),
      ...(g.kmsKeyArn && { kmsKeyId: g.kmsKeyArn }),
      blockedInputMessaging: g.blockedInputMessaging,
      blockedOutputsMessaging: g.blockedOutputsMessaging,
      ...(g.topicPolicy && {
        topicPolicyConfig: {
          topicsConfig: g.topicPolicy.topics,
          ...tierConfig(g.topicPolicy.tier),
        },
      }),
      ...(g.contentPolicy && {
        contentPolicyConfig: {
          filtersConfig: g.contentPolicy.filters,
          ...tierConfig(g.contentPolicy.tier),
        },
      }),
      ...(g.wordPolicy && {
        wordPolicyConfig: {
          ...nonEmpty('wordsConfig', g.wordPolicy.words),
          ...nonEmpty('managedWordListsConfig', g.wordPolicy.managedWordLists),
        },
      }),
      ...(g.sensitiveInformationPolicy && {
        sensitiveInformationPolicyConfig: {
          ...nonEmpty(
            'piiEntitiesConfig',
            g.sensitiveInformationPolicy.piiEntities,
          ),
          ...nonEmpty('regexesConfig', g.sensitiveInformationPolicy.regexes),
        },
      }),
      contextualGroundingPolicyConfig: {
        filtersConfig: grounding.filters,
        tierConfig: { tierName: 'STANDARD' },
      },
      crossRegionConfig: { guardrailProfileIdentifier: profile },
    };
  }
}
