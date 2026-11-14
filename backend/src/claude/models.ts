/**
 * アプリで使う Claude のモデル
 * モデルを変える・廃止されたモデルを差し替えるときは、このファイルだけを変える
 */

/** 会話分析・発言の文脈・ディープサーチに使うモデル */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';

/** 評価（LLM-as-a-Judge）に使うモデル。分析とは別のモデルで、主張と根拠を突き合わせる */
export const JUDGE_MODEL = 'claude-haiku-5-5';

/** 要約の既定のモデル */
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5-5';

/** 要約で選べるモデルの一覧（要約向きの順） */
export const SUMMARY_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5（推奨）' },
  { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5（高速・低コスト）' },
  { id: 'claude-opus-5-5', label: 'claude-opus-5-5（高品質）' },
];
