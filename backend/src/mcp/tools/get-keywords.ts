import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  hashTexts,
  rankKeywords,
  stripSoundTags,
} from '../../ginza/ginza-keywords.utils';
import { readGinzaKeywordCache } from '../../transcription/ginza-keyword-store.service';
import { maskContacts } from '../contact-patterns';
import { ToolRejection } from '../conversation-reader';
import { MAX_KEYWORDS } from '../mcp.constants';
import {
  ToolContext,
  UNTRUSTED_NOTE,
  normalizeForSearch,
  registerAuditedTool,
  transcriptionIdSchema,
} from './tool-helpers';

/** get_keywords: GiNZA で抽出したキーワード */
export function registerGetKeywords(server: McpServer, ctx: ToolContext): void {
  registerAuditedTool(
    server,
    ctx,
    'get_keywords',
    {
      title: '会話のキーワード',
      description:
        '1つの会話（または1人の話者）のキーワードを、出てきた回数の多い順に返します。会話の話題をつかむときや、search_utterances で検索する語を選ぶときに使います。' +
        'アプリで GiNZA のキーワード抽出（ベータ機能）を実行した会話だけ返します。実行していなければ status: "not_extracted"、抽出の後に文字起こしが変わっていれば status: "stale" で、どちらも keywords は空です（アプリで GiNZA を選ぶと抽出し直します）。' +
        '伏せた文字列・連絡先などを含むキーワードは返しません。' +
        UNTRUSTED_NOTE,
      inputSchema: {
        transcriptionId: transcriptionIdSchema,
        speakerId: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            '話者の id（list_transcriptions の speakers[].id。省略すると会話全体）',
          ),
      },
    },
    async ({ transcriptionId, speakerId }) => {
      const conversation = await ctx.reader.get(transcriptionId);
      const masked = conversation.transcription;
      const speaker = speakerId
        ? masked.speakers.find((s) => s.id === speakerId)
        : undefined;
      if (speakerId && !speaker) {
        throw new ToolRejection(`話者が見つかりません: ${speakerId}`);
      }
      const base = {
        transcriptionId,
        ...(speaker && { speakerId: speaker.id, speakerName: speaker.name }),
      };

      // キャッシュは伏せ字にする前の発話から作られているため、ハッシュと並べ替えは元の発話で行う
      const raw = await ctx.reader.readUnmasked(conversation);
      let cached: Awaited<ReturnType<typeof readGinzaKeywordCache>> = null;
      try {
        cached = await readGinzaKeywordCache(
          path.join(ctx.reader.dataDir, 'ginza-keywords'),
          conversation.sourceId,
        );
      } catch (error) {
        ctx.log(`GiNZA のキャッシュを読めません: ${String(error)}`);
      }
      const cache = cached;
      if (!raw || !cache) {
        return {
          result: { ...base, status: 'not_extracted', keywords: [] },
          returned: 0,
          sources: [conversation.sourceId],
        };
      }
      const texts = raw.utterances.map((u) => stripSoundTags(u.text));
      if (
        cache.textsHash !== hashTexts(texts) ||
        cache.terms.length !== texts.length
      ) {
        return {
          result: { ...base, status: 'stale', keywords: [] },
          returned: 0,
          sources: [conversation.sourceId],
        };
      }

      const indices = texts
        .map((_, i) => i)
        .filter((i) => !speakerId || raw.utterances[i].speakerId === speakerId);
      // ほかの会話との比べ（TF-IDF）には、返してよい会話（伏せ字にしたもの）だけを使う
      const others = (await ctx.reader.list())
        .flatMap((e) => (e.conversation ? [e.conversation] : []))
        .filter((c) => c.sourceId !== conversation.sourceId)
        .map((c) => c.transcription.fullText);
      const ranked = rankKeywords(
        indices.map((i) => cache.terms[i]),
        indices.map((i) => texts[i]).join('\n'),
        others,
      );
      const hidden = conversation.maskedTexts.map(normalizeForSearch);
      const keywords = ranked
        .filter(
          (k) =>
            !containsMasked(k.text, hidden) && maskContacts(k.text) === k.text,
        )
        .slice(0, MAX_KEYWORDS);
      return {
        result: { ...base, status: 'ok', keywords },
        returned: keywords.length,
        sources: [conversation.sourceId],
      };
    },
  );
}

/**
 * 伏せた文字列を含むキーワードか
 * 伏せた文字列の一部（氏名の姓だけなど）も、伏せた文字列を推測できるため除く
 */
function containsMasked(keyword: string, hidden: string[]): boolean {
  const k = normalizeForSearch(keyword).replace(/ /g, '');
  if (!k) return false;
  return hidden.some((h) => {
    const t = h.replace(/ /g, '');
    return t.includes(k) || k.includes(t);
  });
}
