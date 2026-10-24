import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolRejection } from '../conversation-reader';
import { DEFAULT_PAGE_UTTERANCES, MAX_PAGE_UTTERANCES } from '../mcp.constants';
import {
  ToolContext,
  UNTRUSTED_NOTE,
  countFitting,
  registerAuditedTool,
  UtteranceView,
  toUtteranceView,
  transcriptionIdSchema,
} from './tool-helpers';

/** get_utterances: 会話の発話を順に読む */
export function registerGetUtterances(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerAuditedTool(
    server,
    ctx,
    'get_utterances',
    {
      title: '発話を順に読む',
      description:
        '1つの会話の発話を、from 番目から count 件まで順に返します。会話の流れを順に読むときに使います。' +
        '続きは結果の nextFrom を from に渡して読みます（nextFrom がなければ最後まで読みました）。' +
        '会話全体を一度に返すツールはありません。必要な範囲だけを読んでください。' +
        UNTRUSTED_NOTE,
      inputSchema: {
        transcriptionId: transcriptionIdSchema,
        from: z
          .number()
          .int()
          .min(0)
          .describe('読み始める発話の番号（0 から）'),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_UTTERANCES)
          .optional()
          .describe(`読む発話の数（既定 ${DEFAULT_PAGE_UTTERANCES}）`),
      },
    },
    async ({ transcriptionId, from, count }) => {
      const conversation = await ctx.reader.get(transcriptionId);
      const total = conversation.transcription.utterances.length;
      if (from >= total && !(from === 0 && total === 0)) {
        throw new ToolRejection(
          `from が範囲外です（この会話の発話は ${total} 件です）`,
        );
      }
      const end = Math.min(from + (count ?? DEFAULT_PAGE_UTTERANCES), total);
      const views: UtteranceView[] = [];
      for (let i = from; i < end; i++) {
        views.push(toUtteranceView(conversation, i));
      }
      const page = views.slice(0, countFitting(views, 300));
      const next = from + page.length;
      return {
        result: {
          transcriptionId,
          utterances: page,
          total,
          ...(next < total && { nextFrom: next }),
        },
        returned: page.length,
        sources: [conversation.sourceId],
      };
    },
  );
}
