/**
 * ディープサーチ（調査）の型
 *
 * 調査は次の段階で進む。各段階の結果を ResearchJob に保存する。
 * ① 会話の読み込み → ② キーワード・公式サイトの提案（ユーザーが確定）→ ③ Web調査
 * → ④ 統合分析 → ⑤ 評価（根拠のない主張を除いてから表示する）
 */

/** 調査の状態 */
export type ResearchStatus =
  | 'proposing' // ①② 会話を読み込み、キーワードと公式サイトを提案中
  | 'awaiting_confirmation' // ユーザーの確定待ち
  | 'researching' // ③ Web調査中
  | 'analyzing' // ④ 統合分析中
  | 'evaluating' // ⑤ 評価中
  | 'completed'
  | 'failed';

/** 会話からの引用（提案の根拠） */
export interface TranscriptQuote {
  transcriptionId: string;
  speakerName: string;
  text: string;
}

/** 調査するキーワードの提案 */
export interface KeywordProposal {
  keyword: string;
  /** 調べる理由（会話のどの話題に関係するか） */
  reason: string;
  /** 選んだ会話全体での出現回数 */
  frequency: number;
  /** 会話での使われ方（原文と一致したものだけ残す） */
  quotes: TranscriptQuote[];
  /** このキーワードを調べる公式サイト（以前の調査にはない） */
  domains?: DomainProposal[];
}

/** 確定した、キーワードと調べる公式サイトの組 */
export interface ResearchTarget {
  keyword: string;
  /** 調べる公式サイトのドメイン（空なら一般のサイトを調べる） */
  domains: string[];
}

/** 調べる公式サイトの提案 */
export interface DomainProposal {
  domain: string;
  /** 運営者（製品名・組織名など） */
  owner: string;
  reason: string;
}

/** Web調査で得た情報源 */
export interface WebSource {
  url: string;
  title: string;
  domain: string;
  /** 確定した公式サイトのドメインに含まれるか */
  official: boolean;
  /** 回答で引用された本文の抜粋 */
  excerpts: string[];
}

/** 統合分析に渡す発言（index は文字起こしの発言の位置） */
export interface TranscriptUtterance {
  index: number;
  speakerName: string;
  start: number;
  text: string;
}

/** Claude に送る前・提案の直後に行った確認の結果 */
export interface PreSendChecks {
  /** 個人情報チェック（Guardrail ID）が設定されているか */
  privacyConfigured: boolean;
  /** 会話ごとの個人情報チェックの結果 */
  privacy: {
    transcriptionId: string;
    /** 個人情報チェックを済ませているか */
    scanned: boolean;
    /** 伏せて送った文字列の種類の数と、置き換えた箇所の数 */
    maskedKinds: number;
    maskedCount: number;
    /** 要確認のまま、伏せずに送った文字列の数 */
    needsReview: number;
  }[];
  /** 伏せた文字列を含むため、キーワード提案の参考に送らなかった頻出語の数 */
  droppedFrequentWords?: number;
  /** 会話に出てこないため、提案から外したキーワード */
  droppedKeywords?: string[];
  /** 会話の原文と一致しないため、外した引用の数 */
  droppedQuotes?: number;
}

/** 会話でキーワードが話題になった発言 */
export interface KeywordMention {
  transcriptionId: string;
  /** 文字起こしでの発言の位置 */
  utteranceIndex: number;
  start: number;
  speakerName: string;
}

/** キーワードが会話で話題になった発言（先頭から表示する数だけ）と、話題になった発言の総数 */
export interface KeywordMentions {
  keyword: string;
  total: number;
  items: KeywordMention[];
}

/** 根拠（統合分析の各文に付く引用） */
export interface ReportCitation {
  /** 根拠の種類 */
  sourceKind: 'conversation' | 'web';
  /** 会話: 文字起こしID / Web: URL */
  sourceId: string;
  /** 表示名（会話: 音声ファイル名 / Web: ページのタイトル） */
  title: string;
  /** 根拠として引用された原文 */
  citedText: string;
  /** Web の場合、公式サイトか */
  official?: boolean;
  /** 会話の場合、引用された最初の発言（文字起こしでの位置・話者・開始時刻）と、引用された発言の数 */
  utterance?: {
    index: number;
    speakerName: string;
    start: number;
    count: number;
  };
}

/** 統合分析の1文（Citations で返る単位） */
export interface ReportSegment {
  text: string;
  citations: ReportCitation[];
}

/** 主張ごとの評価結果 */
export interface ClaimCheck {
  /** 評価した主張（ReportSegment の text） */
  claim: string;
  /** 事実の主張か（見出し・つなぎの文は false） */
  factual: boolean;
  /** 根拠で裏付けられているか */
  verdict: 'supported' | 'partial' | 'unsupported' | 'not_applicable';
  reason: string;
  /** Guardrails の根拠スコア（0〜1。英語の主張だけ） */
  groundingScore?: number;
}

/** AI倫理のチェック結果 */
export interface EthicsCheck {
  item: string;
  passed: boolean;
  detail: string;
}

/** ⑤ 評価の結果 */
export interface ResearchEvaluation {
  /** 事実の主張の数 */
  factualClaims: number;
  /** 根拠が付いている事実の主張の割合（0〜1） */
  citationCoverage: number;
  /** 根拠付きの主張のうち、根拠で裏付けられた割合（0〜1） */
  supportedRate: number;
  /** 根拠がない・裏付けられないため、表示から除いた主張 */
  removedClaims: ClaimCheck[];
  /** 評価モデルと Guardrails の判定が分かれたため、表示は残して確認を促す主張（英語の主張だけ） */
  reviewClaims?: ClaimCheck[];
  /** Guardrails による確認（Guardrail ID が未設定なら null） */
  guardrails?: {
    guardrailId: string;
    /** 根拠スコアのしきい値（これ未満を「根拠と合わない」とみなす） */
    groundingThreshold: number;
    /** 根拠スコアを計算した英語の主張の数 */
    groundingChecked: number;
  } | null;
  /** Web の根拠のうち、公式サイトのものの割合（0〜1。Web の根拠がなければ null） */
  officialSourceRate: number | null;
  /** 論点（キーワード）ごとに、分析が答えているか */
  relevance: { keyword: string; answered: boolean; reason: string }[];
  ethics: EthicsCheck[];
  /** 評価に使ったモデル */
  judgeModel: string;
}

/** 調査ジョブ */
export interface ResearchJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ResearchStatus;
  error?: string;
  /** ① 選んだ会話 */
  transcriptionIds: string[];
  transcriptionNames: Record<string, string>;
  /** ② 提案 */
  proposal?: {
    keywords: KeywordProposal[];
    /** すべてのキーワードの公式サイトをまとめたもの（以前の調査は、この一覧から全キーワード共通で選んだ） */
    domains: DomainProposal[];
  };
  /** ② ユーザーが確定した内容 */
  confirmed?: {
    keywords: string[];
    /** すべてのキーワードの公式サイトをまとめたもの */
    domains: string[];
    /** キーワードごとの公式サイト（以前の調査にはない） */
    targets?: ResearchTarget[];
  };
  /** ③ Web調査の情報源 */
  webSources?: WebSource[];
  /** ④ 統合分析（⑤で根拠のない主張を除いたもの） */
  report?: ReportSegment[];
  /** ⑤ 評価 */
  evaluation?: ResearchEvaluation;
  /** 確定したキーワードが会話で話題になった発言（キーワードごと。文字列の一致で探す） */
  mentions?: KeywordMentions[];
  /** ① 会話の読み込みの後、Claude に送る前・提案の直後に行った確認（以前の調査にはない） */
  preSendChecks?: PreSendChecks;
  /** 使ったモデル */
  models: { analysis: string; judge?: string };
}

/** 一覧表示用のサマリー */
export type ResearchJobSummary = Pick<
  ResearchJob,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'status'
  | 'transcriptionIds'
  | 'transcriptionNames'
> & { keywords: string[] };
