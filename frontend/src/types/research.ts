/**
 * ディープサーチ（調査）の型（backend/src/research/types/research.types.ts と同じ形）
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
    domains: DomainProposal[];
  };
  /** ② ユーザーが確定した内容 */
  confirmed?: {
    keywords: string[];
    domains: string[];
  };
  /** ③ Web調査の情報源 */
  webSources?: WebSource[];
  /** ④ 統合分析（⑤で根拠のない主張を除いたもの） */
  report?: ReportSegment[];
  /** ⑤ 評価 */
  evaluation?: ResearchEvaluation;
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
