import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ToolContext,
  UNTRUSTED_NOTE,
  countFitting,
  decodeCursor,
  encodeCursor,
  registerAuditedTool,
} from './tool-helpers';

/** list_transcriptions: 会話の一覧（新しい順） */
export function registerListTranscriptions(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerAuditedTool(
    server,
    ctx,
    'list_transcriptions',
    {
      title: '会話の一覧',
      description:
        'AI Speak Trace で文字起こしした会話の一覧を新しい順に返します。最初にこれを呼び、ほかのツールに渡す id を確かめてください。' +
        '各会話の privacy が checked のものだけ、ほかのツールで読めます。それ以外（unchecked・stale・needs_review・error）は reason に読めない理由と、アプリでの対処を示します。' +
        '結果が多い場合は nextCursor を cursor に渡すと続きを返します。' +
        UNTRUSTED_NOTE,
      inputSchema: {
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe('前回の結果の nextCursor（続きを読むとき）'),
      },
    },
    async ({ cursor }) => {
      const offset = decodeCursor(cursor);
      const entries = await ctx.reader.list();
      const items = entries
        .map((e) => {
          const t = e.conversation?.transcription;
          return t
            ? {
                id: e.id,
                audioFileName: t.audioFileName,
                createdAt: t.createdAt,
                speakers: t.speakers.map((s) => ({ id: s.id, name: s.name })),
                utteranceCount: t.utterances.length,
                privacy: e.privacy,
              }
            : {
                id: e.id,
                ...(e.createdAt !== undefined && { createdAt: e.createdAt }),
                ...(e.utteranceCount !== undefined && {
                  utteranceCount: e.utteranceCount,
                }),
                privacy: e.privacy,
                reason: e.reason,
              };
        })
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

      const rest = items.slice(offset);
      const page = rest.slice(0, countFitting(rest, 200));
      const next = offset + page.length;
      return {
        result: {
          transcriptions: page,
          total: items.length,
          ...(next < items.length && { nextCursor: encodeCursor(next) }),
        },
        returned: page.length,
      };
    },
  );
}
