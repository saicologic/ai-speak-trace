import { ResearchErrorInfo } from './types/research.types';

/** アプリの再起動で中断した調査のエラー */
export const INTERRUPTED_MESSAGE =
  'アプリの再起動で中断しました。途中から再開できます';

/** Anthropic API のエラー（SDK のエラー文「{HTTP ステータス} {エラーの JSON}」）から取り出す */
const ANTHROPIC_ERROR = /(\d{3}) \{"type":"error","error":\{"type":"([a-z_]+)"/;

/** 失敗の種類ごとの、画面に出す説明 */
const INFO: Record<
  ResearchErrorInfo['kind'],
  Omit<ResearchErrorInfo, 'kind'>
> = {
  credit: {
    title: 'Anthropic API のクレジットが不足しています',
    hint: 'Anthropic Console の「Plans & Billing」でクレジットを追加してから、再開してください。反映まで数分かかることがあります',
    retryable: true,
  },
  auth: {
    title: 'Anthropic API キーが無効です',
    hint: '設定画面で Anthropic API キーを確かめてから、再開してください',
    retryable: true,
  },
  permission: {
    title: 'Anthropic API キーに、使う権限がありません',
    hint: 'Anthropic Console で、API キーの組織と、使うモデルの権限を確かめてから、再開してください',
    retryable: true,
  },
  rate_limit: {
    title: 'Anthropic API の利用回数の上限に達しました',
    hint: 'しばらく待ってから、再開してください',
    retryable: true,
  },
  overloaded: {
    title: 'Anthropic API が混み合っています',
    hint: 'しばらく待ってから、再開してください',
    retryable: true,
  },
  server: {
    title: 'Anthropic API でエラーが起きました',
    hint: 'しばらく待ってから、再開してください',
    retryable: true,
  },
  network: {
    title: 'Anthropic API に接続できませんでした',
    hint: 'インターネットの接続を確かめてから、再開してください',
    retryable: true,
  },
  aws: {
    title: 'Amazon Bedrock Guardrails で確認できませんでした',
    hint: '設定画面の AWS プロファイルと Guardrail ID、~/.aws の認証情報を確かめてから、再開してください。~/.aws を変えた場合は、アプリの再起動が必要です',
    retryable: true,
  },
  settings: {
    title: '設定が足りないため、Claude に送れませんでした',
    hint: '下の詳細に書かれた設定を、設定画面で直してから、再開してください',
    retryable: true,
  },
  blocked: {
    title: 'Guardrails のチェックで、Claude に送るのを止めました',
    hint: '下の詳細に書かれた理由を確かめてください。同じ内容のまま再開しても、同じ理由で止まります。個人情報チェックで伏せる文字列を選び直すか、選ぶ会話・キーワードを変えて、新しく調査を始めてください',
    retryable: false,
  },
  not_found: {
    title: '調べる会話が見つかりません',
    hint: '会話が削除された可能性があります。会話を選び直して、新しく調査を始めてください',
    retryable: false,
  },
  no_sources: {
    title: 'Web調査で、分析に使える情報が見つかりませんでした',
    hint: 'キーワードや公式サイトを選び直して、新しく調査を始めてください',
    retryable: false,
  },
  interrupted: {
    title: 'アプリの再起動で、調査が中断しました',
    hint: '終わっている段階はそのまま使い、続きから再開できます',
    retryable: true,
  },
  unknown: {
    title: '調査に失敗しました',
    hint: '下の詳細を確かめてから、再開してください。同じエラーが続く場合は、新しく調査を始めてください',
    retryable: true,
  },
};

/** 失敗の種類と、画面に出す説明・再開できるかを返す */
export function describeResearchError(error: unknown): ResearchErrorInfo {
  const kind = classify(error);
  return { kind, ...INFO[kind] };
}

/**
 * 失敗の種類を判定する
 * Web調査の失敗はエラー文だけが残るため、エラーの型ではなくエラー文で判定する
 */
function classify(error: unknown): ResearchErrorInfo['kind'] {
  const message = error instanceof Error ? error.message : String(error);
  const name = (error as { name?: unknown } | null)?.name;
  if (message === INTERRUPTED_MESSAGE) return 'interrupted';
  if (/credit balance/i.test(message)) return 'credit';

  const api = message.match(ANTHROPIC_ERROR);
  if (api) {
    const [, status, type] = api;
    if (type === 'billing_error') return 'credit';
    if (status === '401' || type === 'authentication_error') return 'auth';
    if (status === '403' || type === 'permission_error') return 'permission';
    if (status === '429' || type === 'rate_limit_error') return 'rate_limit';
    if (status === '529' || type === 'overloaded_error') return 'overloaded';
    if (status.startsWith('5')) return 'server';
    return 'unknown';
  }
  if (
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    /^(Connection error\.|Request timed out\.)/.test(message) ||
    /\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b/.test(message)
  ) {
    return 'network';
  }
  // Claude の呼び出し（claude-client.service.ts）と Guardrails（guardrail.service.ts）のエラー文
  if (/Claude に送りませんでした|応答を使いませんでした/.test(message)) {
    return 'blocked';
  }
  if (
    /AWS|Guardrails で確認できませんでした|Guardrails がチェックしなかった/.test(
      message,
    )
  ) {
    return 'aws';
  }
  if (
    /AI 分析が OFF|Guardrail ID を設定してください|Guardrail ID が設定されていません/.test(
      message,
    )
  ) {
    return 'settings';
  }
  if (/文字起こしが見つかりません/.test(message)) return 'not_found';
  if (/分析に使える情報源が見つかりませんでした/.test(message)) {
    return 'no_sources';
  }
  return 'unknown';
}

/** 待つか設定を直せば直る失敗の種類（Web調査でこの失敗があれば、調査を止めて再開できるようにする） */
const TRANSIENT_KINDS: ResearchErrorInfo['kind'][] = [
  'credit',
  'auth',
  'permission',
  'rate_limit',
  'overloaded',
  'server',
  'network',
  'aws',
  'settings',
];

/**
 * キーワードの Web調査の失敗で、調査を止めるか
 * 止めない失敗（ページが見つからないなど）は、これまでどおりほかのキーワードの結果で続ける
 */
export function stopsWebResearch(error: string): boolean {
  return TRANSIENT_KINDS.includes(classify(error));
}
