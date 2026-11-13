/** フィルター・トピック・単語などの1件（get-guardrail と update-guardrail で同じ形） */
type PolicyItem = Record<string, unknown>;

/** get-guardrail の出力（使う項目だけ） */
export interface GetGuardrailResult {
  name: string;
  guardrailId: string;
  guardrailArn?: string;
  version?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  blockedInputMessaging: string;
  blockedOutputsMessaging: string;
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
  blockedInputMessaging: string;
  blockedOutputsMessaging: string;
  contextualGroundingPolicyConfig: {
    filtersConfig: PolicyItem[];
    tierConfig: { tierName: 'STANDARD' };
  };
  crossRegionConfig: { guardrailProfileIdentifier: string };
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
    return {
      guardrailIdentifier: g.guardrailId,
      name: g.name,
      blockedInputMessaging: g.blockedInputMessaging,
      blockedOutputsMessaging: g.blockedOutputsMessaging,
      contextualGroundingPolicyConfig: {
        filtersConfig: g.contextualGroundingPolicy!.filters,
        tierConfig: { tierName: 'STANDARD' },
      },
      crossRegionConfig: {
        guardrailProfileIdentifier: g.crossRegionDetails!.guardrailProfileId!,
      },
    };
  }
}
