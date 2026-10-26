import type Anthropic from '@anthropic-ai/sdk';
import { GuardrailFindings } from '../privacy/guardrail.service';
import { PiiFinding } from '../privacy/privacy.types';
import { maskText, toFindings } from '../privacy/privacy.utils';

/** Claude に送る前のチェックで、送信を止めるコンテンツフィルターの種類 */
const BLOCKING_CONTENT_TYPES = new Set(['PROMPT_ATTACK']);

/** 応答のチェックで、検出したら応答を使わない信頼度（これより低い MEDIUM は警告として返す） */
const OUTPUT_BLOCKING_CONFIDENCE = 'HIGH';

/** 応答のチェックで、警告として返す信頼度 */
const OUTPUT_WARNING_CONFIDENCES = new Set(['MEDIUM', 'HIGH']);

/**
 * テキストの出どころ
 * - trusted: アプリが書いた指示（system と、user のテキスト）
 * - untrusted: 外から来た内容（文書・ツールの結果・Claude の応答）。プロンプト攻撃を確認する
 */
export type TextTrust = 'trusted' | 'untrusted';

/** Guardrails でチェックできない内容（画像・PDF など）が含まれている場合の例外 */
export class UnsupportedContentError extends Error {}

/**
 * Claude に送るリクエストの、Guardrails でチェックするテキストをすべて fn で置き換えた複製を返す
 * - system と、user の発言（テキスト・テキストの文書・ツールの結果）が対象
 * - assistant の発言（pause_turn の再開で送り返す応答）は、本文と引用本文を fn で置き換え、
 *   書き換えると API に拒否される内容（思考・検索結果の題名・ツールの入力）は inspect に渡してチェックだけ行う
 * - チェックできない内容（画像・PDF・URL の文書など）は、チェックせずに送らないよう例外を投げる
 * テキストの収集と伏せ字への置き換えで同じ関数を使い、チェックした範囲と置き換える範囲を一致させる
 */
export function mapRequestTexts(
  params: Anthropic.MessageCreateParamsNonStreaming,
  fn: (text: string, trust: TextTrust) => string,
  inspect: (text: string) => void = () => {},
): Anthropic.MessageCreateParamsNonStreaming {
  const trusted = (text: string) => fn(text, 'trusted');
  const untrusted = (text: string) => fn(text, 'untrusted');
  return {
    ...params,
    ...(params.system !== undefined && {
      system:
        typeof params.system === 'string'
          ? trusted(params.system)
          : params.system.map((b) => ({ ...b, text: trusted(b.text) })),
    }),
    messages: params.messages.map((m) => ({
      ...m,
      content:
        m.role === 'user'
          ? mapContent(m.content, trusted, untrusted)
          : mapAssistantContent(m.content, untrusted, inspect),
    })),
  };
}

/**
 * assistant の発言のテキストを置き換える
 * 検索結果の本文（encrypted_content）と思考の署名は Anthropic が生成した暗号化データで、読めないためチェックしない
 */
function mapAssistantContent(
  content: Anthropic.MessageParam['content'],
  fn: (text: string) => string,
  inspect: (text: string) => void,
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return fn(content);
  return content.map((block): Anthropic.ContentBlockParam => {
    switch (block.type) {
      case 'text':
        return {
          ...block,
          text: fn(block.text),
          ...(block.citations && {
            citations: block.citations.map((c) => ({
              ...c,
              cited_text: fn(c.cited_text),
            })),
          }),
        };
      case 'thinking':
        inspect(block.thinking);
        return block;
      case 'redacted_thinking':
        return block;
      // tool_use は、外から来た内容を tool_result で渡すためにアプリが書いたツール呼び出し（untrusted-source.ts）
      case 'server_tool_use':
      case 'tool_use':
        inspect(JSON.stringify(block.input));
        return block;
      case 'web_search_tool_result':
        if (Array.isArray(block.content)) {
          for (const r of block.content) inspect(r.title);
        }
        return block;
      default:
        throw new UnsupportedContentError(
          `Guardrails でチェックできない内容です: assistant.${block.type}`,
        );
    }
  });
}

/** user の発言のテキストを置き換える（テキストは trusted、文書とツールの結果は untrusted） */
function mapContent(
  content: Anthropic.MessageParam['content'],
  trusted: (text: string) => string,
  untrusted: (text: string) => string,
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return trusted(content);
  return content.map((block) => mapBlock(block, trusted, untrusted));
}

function mapBlock(
  block: Anthropic.ContentBlockParam,
  trusted: (text: string) => string,
  fn: (text: string) => string,
): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { ...block, text: trusted(block.text) };
    case 'document':
      return mapDocument(block, fn);
    case 'tool_result':
      return {
        ...block,
        ...(block.content !== undefined && {
          content:
            typeof block.content === 'string'
              ? fn(block.content)
              : block.content.map((c) => {
                  if (c.type === 'text') return { ...c, text: fn(c.text) };
                  throw new UnsupportedContentError(
                    `Guardrails でチェックできない内容です: tool_result.${c.type}`,
                  );
                }),
        }),
      };
    default:
      throw new UnsupportedContentError(
        `Guardrails でチェックできない内容です: ${block.type}`,
      );
  }
}

function mapDocument(
  block: Anthropic.DocumentBlockParam,
  fn: (text: string) => string,
): Anthropic.DocumentBlockParam {
  const source = block.source;
  const meta = {
    ...(block.title != null && { title: fn(block.title) }),
    ...(block.context != null && { context: fn(block.context) }),
  };
  if (source.type === 'text') {
    return { ...block, ...meta, source: { ...source, data: fn(source.data) } };
  }
  if (source.type === 'content') {
    return {
      ...block,
      ...meta,
      source: {
        ...source,
        content:
          typeof source.content === 'string'
            ? fn(source.content)
            : source.content.map((c) => {
                if (c.type === 'text') return { ...c, text: fn(c.text) };
                throw new UnsupportedContentError(
                  `Guardrails でチェックできない内容です: document.${c.type}`,
                );
              }),
      },
    };
  }
  throw new UnsupportedContentError(
    `Guardrails でチェックできない内容です: document.${source.type}`,
  );
}

/** リクエストの、チェックはするが書き換えられないテキスト（assistant の思考・検索語・検索結果の題名）を集める */
export function collectImmutableRequestTexts(
  params: Anthropic.MessageCreateParamsNonStreaming,
): string[] {
  const texts: string[] = [];
  mapRequestTexts(
    params,
    (text) => text,
    (text) => texts.push(text),
  );
  return texts;
}

/** リクエストの、Guardrails でチェックするテキストを集める */
export function collectRequestText(
  params: Anthropic.MessageCreateParamsNonStreaming,
): string {
  const texts: string[] = [];
  mapRequestTexts(
    params,
    (text) => {
      texts.push(text);
      return text;
    },
    (text) => texts.push(text),
  );
  return texts.join('\n');
}

/**
 * リクエストの、Guardrails でチェックするテキストを出どころごとに集める
 * - 文書・ツールの結果・assistant の発言は untrusted
 * - system と user のテキストは trusted。ただし、その中に埋め込んだ外からの内容（untrustedSnippets。
 *   プロンプトに埋め込んだ会話の全文など）は untrusted に移す
 * アプリが書いた指示がプロンプト攻撃と誤検出されないよう、プロンプト攻撃は untrusted だけで確認する
 */
export function collectRequestTextByTrust(
  params: Anthropic.MessageCreateParamsNonStreaming,
  untrustedSnippets: string[],
): { trusted: string; untrusted: string } {
  const snippets = [...new Set(untrustedSnippets.filter((s) => s.trim()))].sort(
    (a, b) => b.length - a.length,
  );
  const trusted: string[] = [];
  const untrusted: string[] = [];
  mapRequestTexts(
    params,
    (text, trust) => {
      if (trust === 'untrusted') {
        untrusted.push(text);
        return text;
      }
      let rest = text;
      for (const snippet of snippets) {
        if (!rest.includes(snippet)) continue;
        untrusted.push(snippet);
        rest = rest.split(snippet).join('\n');
      }
      if (rest.trim()) trusted.push(rest);
      return text;
    },
    (text) => untrusted.push(text),
  );
  return { trusted: trusted.join('\n'), untrusted: untrusted.join('\n') };
}

/** 送信を止める検出（プロンプト攻撃など）があれば、その種類を返す */
export function findBlockingContent(findings: GuardrailFindings): string[] {
  return [
    ...new Set(
      findings.content
        .filter((c) => BLOCKING_CONTENT_TYPES.has(c.type))
        .map((c) => c.type),
    ),
  ];
}

/** 応答のコンテンツフィルターの検出（侮辱・暴力など） */
export interface ContentWarning {
  type: string;
  confidence: string;
}

/** 応答で、使わない検出（信頼度 HIGH の侮辱・暴力など）を返す */
export function findBlockingOutputContent(
  findings: GuardrailFindings,
): ContentWarning[] {
  return findings.content.filter(
    (c) =>
      !BLOCKING_CONTENT_TYPES.has(c.type) &&
      c.confidence === OUTPUT_BLOCKING_CONFIDENCE,
  );
}

/** 応答で、警告として利用者に示す検出（信頼度 MEDIUM 以上の侮辱・暴力など。種類ごとに1件） */
export function findOutputWarnings(
  findings: GuardrailFindings,
): ContentWarning[] {
  const byType = new Map<string, ContentWarning>();
  for (const c of findings.content) {
    if (BLOCKING_CONTENT_TYPES.has(c.type)) continue;
    if (!OUTPUT_WARNING_CONFIDENCES.has(c.confidence)) continue;
    if (byType.get(c.type)?.confidence === 'HIGH') continue;
    byType.set(c.type, { type: c.type, confidence: c.confidence });
  }
  return [...byType.values()];
}

/** コンテンツフィルターの種類の表示名 */
const CONTENT_LABELS: Record<string, string> = {
  HATE: 'ヘイト',
  INSULTS: '侮辱',
  SEXUAL: '性的な表現',
  VIOLENCE: '暴力',
  MISCONDUCT: '不正行為',
  PROMPT_ATTACK: 'プロンプト攻撃',
};

export function contentLabel(type: string): string {
  return CONTENT_LABELS[type] ?? type;
}

/**
 * 検出した個人情報のうち、自動で伏せるもの
 * 連絡先・カード番号・アクセスキーなどは伏せる。氏名・住所など誤検出の多い種類は、
 * 製品名・会社名なども検出されて分析ができなくなるため、個人情報チェックの画面で利用者が選んだものだけを伏せる
 */
export function toAutoMaskFindings(
  findings: GuardrailFindings,
  text: string,
): PiiFinding[] {
  return toFindings(findings.pii, text).filter((f) => f.mask);
}

/** Claude の応答のテキストブロック（本文と引用本文）を fn で置き換えた複製を返す */
export function mapResponseTexts(
  message: Anthropic.Message,
  fn: (text: string) => string,
): Anthropic.Message {
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === 'text'
        ? {
            ...block,
            text: fn(block.text),
            citations:
              block.citations?.map((c) => ({
                ...c,
                cited_text: fn(c.cited_text),
              })) ?? block.citations,
          }
        : block,
    ),
  };
}

/**
 * 応答の、チェックはするが書き換えられないテキスト（思考・検索語・検索結果の題名）を集める
 * 書き換えると、pause_turn の再開で送り返したときに API に拒否されるため
 */
export function collectImmutableResponseTexts(
  message: Anthropic.Message,
): string[] {
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'thinking') texts.push(block.thinking);
    if (block.type === 'server_tool_use') {
      texts.push(JSON.stringify(block.input));
    }
    if (
      block.type === 'web_search_tool_result' &&
      Array.isArray(block.content)
    ) {
      for (const r of block.content) texts.push(r.title);
    }
  }
  return texts;
}

/** 応答の、Guardrails でチェックするテキスト（本文・引用本文と、書き換えられないテキスト）を集める */
export function collectResponseText(message: Anthropic.Message): string {
  const texts: string[] = [];
  mapResponseTexts(message, (text) => {
    texts.push(text);
    return text;
  });
  return [...texts, ...collectImmutableResponseTexts(message)].join('\n');
}

/** 伏せる文字列のうち、書き換えられないテキストに含まれているもの（伏せられないため、送らない・返さない） */
export function findUnmaskable(
  immutableTexts: string[],
  masks: PiiFinding[],
): PiiFinding[] {
  return masks.filter((m) => immutableTexts.some((t) => t.includes(m.text)));
}

/** 伏せる文字列を置き換える関数を返す（伏せるものがなければ何もしない） */
export function masker(findings: PiiFinding[]): (text: string) => string {
  return findings.length > 0
    ? (text) => maskText(text, findings)
    : (text) => text;
}
