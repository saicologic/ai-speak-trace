import type Anthropic from '@anthropic-ai/sdk';

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

/** 100 万トークンあたりの単価（米ドル） */
interface TokenPrices {
  input: number;
  output: number;
  /** キャッシュの書き込み（5 分） */
  cacheWrite5m: number;
  /** キャッシュの書き込み（1 時間） */
  cacheWrite1h: number;
  /** キャッシュの読み込み */
  cacheRead: number;
}

/** モデルの単価。入力とキャッシュの合計が longContextThreshold を超える呼び出しは longContext の単価になる */
interface ModelPrices extends TokenPrices {
  longContextThreshold?: number;
  longContext?: TokenPrices;
}

/**
 * モデルごとの単価（米ドル / 100 万トークン）
 * 出典: Anthropic の公式の料金ページ https://platform.claude.com/docs/en/about-claude/pricing
 * 単価が変わったら、ここを直す
 */
const MODEL_PRICES: Record<string, ModelPrices> = {
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
  },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    longContextThreshold: 100_000,
    longContext: {
      input: 0.5,
      output: 2.5,
      cacheWrite5m: 0.625,
      cacheWrite1h: 1,
      cacheRead: 0.05,
    },
  },
};

/** Web 検索 1 回の単価（米ドル。1,000 回あたり $10） */
const WEB_SEARCH_PRICE = 10 / 1000;

const PER_TOKEN = 1 / 1_000_000;

/**
 * 1 回の呼び出しの費用の目安（米ドル）を、応答の usage から計算する
 * 単価の表にないモデルは null（不明）を返す
 */
export function estimateCostUsd(
  model: string,
  usage: Anthropic.Usage,
): number | null {
  const prices = MODEL_PRICES[model];
  if (!prices) return null;

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // 内訳がないときは、既定の 5 分のキャッシュとして扱う
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheWrite5m = usage.cache_creation
    ? usage.cache_creation.ephemeral_5m_input_tokens
    : cacheWrite;

  // 単価の計算と同じく、内訳があれば内訳の合計で数える
  const promptTokens =
    usage.input_tokens + cacheRead + cacheWrite5m + cacheWrite1h;
  const p =
    prices.longContext &&
    prices.longContextThreshold !== undefined &&
    promptTokens > prices.longContextThreshold
      ? prices.longContext
      : prices;

  const tokenCost =
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      cacheRead * p.cacheRead +
      cacheWrite5m * p.cacheWrite5m +
      cacheWrite1h * p.cacheWrite1h) *
    PER_TOKEN;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return tokenCost + searches * WEB_SEARCH_PRICE;
}
