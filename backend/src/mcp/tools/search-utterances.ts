import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MaskedConversation, ToolRejection } from '../conversation-reader';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_QUERY_CHARS,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_TRANSCRIPTIONS,
} from '../mcp.constants';
import {
  ToolContext,
  UNTRUSTED_NOTE,
  countFitting,
  decodeCursor,
  encodeCursor,
  normalizeForSearch,
  registerAuditedTool,
  toUtteranceView,
  transcriptionIdSchema,
} from './tool-helpers';

/** search_utterances: 発話を語で検索する */
export function registerSearchUtterances(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerAuditedTool(
    server,
    ctx,
    'search_utterances',
    {
      title: '発話の検索',
      description:
        '会話の発話を語で検索し、見つかった発話を返します。話題が出てきた発話を探すときに使います。' +
        'query は空白で区切ると、すべての語を含む発話だけを返します（全角・半角と大文字・小文字は区別しません）。' +
        '検索は伏せ字にした後の本文で行うため、伏せた名前などでは見つかりません。' +
        '見つかった発話の前後は get_context で読めます。結果の cite（例: Aさん 12:34）を引用元として示してください。' +
        UNTRUSTED_NOTE,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(MAX_QUERY_CHARS)
          .describe('検索する語（空白区切りで AND）'),
        transcriptionIds: z
          .array(transcriptionIdSchema)
          .min(1)
          .max(MAX_SEARCH_TRANSCRIPTIONS)
          .optional()
          .describe('検索する会話の id（省略すると読めるすべての会話）'),
        speakerName: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe('話者名で絞り込む（例: Aさん。完全一致）'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`返す発話の数（既定 ${DEFAULT_SEARCH_LIMIT}）`),
        cursor: z
          .string()
          .max(200)
          .optional()
          .describe('前回の結果の nextCursor（続きを読むとき）'),
      },
    },
    async ({ query, transcriptionIds, speakerName, limit, cursor }) => {
      const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
      if (terms.length === 0) {
        throw new ToolRejection('query に検索する語を入れてください');
      }
      const offset = decodeCursor(cursor);
      const conversations = await targetConversations(ctx, transcriptionIds);
      const speaker = speakerName && normalizeForSearch(speakerName.trim());

      const matches: { conversation: MaskedConversation; index: number }[] = [];
      for (const conversation of conversations) {
        conversation.transcription.utterances.forEach((u, index) => {
          if (speaker && normalizeForSearch(u.speakerName) !== speaker) return;
          const text = normalizeForSearch(u.text);
          if (terms.every((term) => text.includes(term))) {
            matches.push({ conversation, index });
          }
        });
      }

      const hits = matches.slice(
        offset,
        offset + (limit ?? DEFAULT_SEARCH_LIMIT),
      );
      const views = hits.map(({ conversation, index }) =>
        toUtteranceView(conversation, index),
      );
      const page = views.slice(0, countFitting(views, 300));
      const next = offset + page.length;
      return {
        result: {
          utterances: page,
          total: matches.length,
          ...(next < matches.length && { nextCursor: encodeCursor(next) }),
        },
        returned: page.length,
        sources: hits
          .slice(0, page.length)
          .map(({ conversation }) => conversation.sourceId),
      };
    },
  );
}

/**
 * 検索する会話（新しい順）
 * 指定した会話は、返せないものが1つでもあれば理由とともに断る。指定しなければ返せる会話だけ
 */
async function targetConversations(
  ctx: ToolContext,
  ids: string[] | undefined,
): Promise<MaskedConversation[]> {
  if (ids) {
    const result: MaskedConversation[] = [];
    for (const id of new Set(ids)) result.push(await ctx.reader.get(id));
    return result;
  }
  return (await ctx.reader.list())
    .flatMap((e) => (e.conversation ? [e.conversation] : []))
    .sort((a, b) =>
      (b.transcription.createdAt ?? '').localeCompare(
        a.transcription.createdAt ?? '',
      ),
    );
}
