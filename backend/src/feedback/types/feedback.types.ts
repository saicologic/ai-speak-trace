/** 報告の対象の機能 */
export const FEEDBACK_FEATURES = [
  'summary',
  'analysis',
  'context',
  'research',
] as const;
export type FeedbackFeature = (typeof FEEDBACK_FEATURES)[number];

/** 報告の種類 */
export const FEEDBACK_CATEGORIES = [
  /** 事実の誤り */
  'factual_error',
  /** 元の会話・出典にない内容 */
  'unsupported',
  /** 個人の推測・評価 */
  'personal_judgement',
  /** 不適切な表現 */
  'inappropriate',
  /** その他 */
  'other',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/**
 * AI が生成した結果への、利用者からの誤りの報告
 * 報告は端末にだけ保存し、外部には送らない。結果を見直すときと、評価（eval/）のデータを作るときに使う
 */
export interface Feedback {
  id: string;
  createdAt: string;
  feature: FeedbackFeature;
  /** 報告した結果の ID（要約・会話分析のログの ID、調査の ID。保存しない結果は空） */
  targetId: string;
  /** 結果を作った文字起こし（文字起こしの削除時に、報告も削除する） */
  transcriptionId: string;
  /**
   * 結果を作った文字起こしのすべて（ディープサーチのように複数の会話を使う結果だけ）
   * どれか1つの文字起こしを削除したときにも、報告を削除する
   */
  transcriptionIds?: string[];
  category: FeedbackCategory;
  /** 誤りだと思った箇所（任意） */
  quote: string;
  /** コメント（任意） */
  comment: string;
}
