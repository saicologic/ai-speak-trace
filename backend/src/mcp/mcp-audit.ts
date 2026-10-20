import * as fs from 'fs/promises';
import * as path from 'path';
import { MAX_QUERY_CHARS, MCP_AUDIT_DIR } from './mcp.constants';

/** MCP のツールの呼び出し1回の記録（発話の本文は残さない） */
export interface McpAuditRecord {
  /** 記録した日時（ISO 8601） */
  at: string;
  tool: string;
  /** 呼び出しの引数（query は MAX_QUERY_CHARS まで） */
  args: Record<string, unknown>;
  /** 返した件数（会話・発話・キーワードの数） */
  returned: number;
  /**
   * 結果
   * - ok: 返した
   * - rejected: 不正な引数・返さない会話のため断った
   * - error: 読み込みなどに失敗した
   */
  outcome: 'ok' | 'rejected' | 'error';
  reason?: string;
}

/**
 * MCP のツールの呼び出しを記録する（claude-audit.store.ts と同じ書き方）
 * どの会話をいつ・どのツールで読まれたかを後から確かめられるようにする。
 * 月ごとの JSON Lines ファイル（2026-10.jsonl など）に追記する。
 */
export class McpAudit {
  private readonly storeDir: string;

  constructor(
    dataDir: string,
    private readonly warn: (message: string) => void,
  ) {
    this.storeDir = path.join(dataDir, MCP_AUDIT_DIR);
  }

  /** 記録を追記する（記録に失敗しても、ツールの呼び出しは止めない） */
  async append(record: McpAuditRecord): Promise<void> {
    try {
      await fs.mkdir(this.storeDir, { recursive: true });
      const file = path.join(this.storeDir, `${record.at.slice(0, 7)}.jsonl`);
      const line = { ...record, args: sanitizeArgs(record.args) };
      await fs.appendFile(file, `${JSON.stringify(line)}\n`, 'utf-8');
    } catch (error) {
      this.warn(`MCP の呼び出しを記録できませんでした: ${String(error)}`);
    }
  }
}

/** 記録に残す引数（長い query は切り詰める） */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result = { ...args };
  if (typeof result.query === 'string') {
    result.query = result.query.slice(0, MAX_QUERY_CHARS);
  }
  return result;
}
