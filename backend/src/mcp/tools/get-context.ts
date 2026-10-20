import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolRejection } from '../conversation-reader';
import {
  DEFAULT_CONTEXT,
  MAX_CONTEXT,
  MAX_RESPONSE_CHARS,
} from '../mcp.constants';
import {
  ToolContext,
  UNTRUSTED_NOTE,
  registerAuditedTool,
  UtteranceView,
  toUtteranceView,
  transcriptionIdSchema,
} from './tool-helpers';

/** get_context: 発話の前後を読む */
export function registerGetContext(server: McpServer, ctx: ToolContext): void {
  const range = (label: string) =>
    z
      .number()
      .int()
      .min(0)
      .max(MAX_CONTEXT)
      .optional()
      .describe(`${label}の発話の数（既定 ${DEFAULT_CONTEXT}）`);
  registerAuditedTool(
    server,
    ctx,
    'get_context',
    {
      title: '発話の前後を読む',
      description:
        '1つの発話と、その前後の発話を返します。search_utterances で見つけた発話が、どんな流れで話されたかを確かめるときに使います。' +
        '指定した発話には center: true が付きます。結果が大きすぎる場合は中心から遠い発話を除き、truncated: true を付けます。' +
        UNTRUSTED_NOTE,
      inputSchema: {
        transcriptionId: transcriptionIdSchema,
        index: z.number().int().min(0).describe('中心にする発話の番号'),
        before: range('前'),
        after: range('後'),
      },
    },
    async ({ transcriptionId, index, before, after }) => {
      const conversation = await ctx.reader.get(transcriptionId);
      const total = conversation.transcription.utterances.length;
      if (index >= total) {
        throw new ToolRejection(
          `index が範囲外です（この会話の発話は ${total} 件です）`,
        );
      }
      const start = Math.max(0, index - (before ?? DEFAULT_CONTEXT));
      const end = Math.min(total, index + (after ?? DEFAULT_CONTEXT) + 1);
      const utterances: UtteranceView[] = [];
      for (let i = start; i < end; i++) {
        const view = toUtteranceView(conversation, i);
        utterances.push(
          i === index ? { ...view, center: true as const } : view,
        );
      }
      // 結果が大きすぎる場合は、中心の発話を残し、中心から遠い発話から除く
      let size = JSON.stringify(utterances).length;
      let truncated = false;
      while (size > MAX_RESPONSE_CHARS - 300 && utterances.length > 1) {
        const first = utterances[0];
        const last = utterances[utterances.length - 1];
        const removed =
          index - first.index > last.index - index
            ? utterances.shift()
            : utterances.pop();
        size -= JSON.stringify(removed).length + 1;
        truncated = true;
      }
      return {
        result: {
          transcriptionId,
          utterances,
          total,
          ...(truncated && { truncated: true }),
        },
        returned: utterances.length,
        sources: [conversation.sourceId],
      };
    },
  );
}
