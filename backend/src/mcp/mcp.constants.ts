/** MCP サーバーの名前（クライアントの一覧に出る） */
export const MCP_SERVER_NAME = 'ai-speak-trace';

/** 1回の結果（JSON）の文字数の上限。超える分は cursor・nextFrom で続きを返す */
export const MAX_RESPONSE_CHARS = 50_000;

/** 1つの発話の本文の文字数の上限。超えたら切り詰めて truncated: true を付ける */
export const MAX_UTTERANCE_CHARS = 2_000;

/** search_utterances で1回に返す発話の数 */
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

/** get_utterances で1回に返す発話の数 */
export const DEFAULT_PAGE_UTTERANCES = 50;
export const MAX_PAGE_UTTERANCES = 100;

/** get_context で前後に返す発話の数 */
export const DEFAULT_CONTEXT = 3;
export const MAX_CONTEXT = 10;

/** 検索語の文字数の上限（監査ログにもこの長さまで残す） */
export const MAX_QUERY_CHARS = 200;

/** search_utterances で絞り込める会話の数 */
export const MAX_SEARCH_TRANSCRIPTIONS = 50;

/** get_keywords で返すキーワードの数 */
export const MAX_KEYWORDS = 100;

/** 監査ログの保存先（DATA_DIR 配下） */
export const MCP_AUDIT_DIR = 'mcp-audit-logs';
