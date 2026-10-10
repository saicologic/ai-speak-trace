import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeClientService } from '../claude/claude-client.service';
import { CLAUDE_MODEL } from '../claude/analysis.service';
import {
  assertCompleteResponse,
  extractText,
} from '../claude/claude-response.utils';
import { ReportSegment, WebSource } from './types/research.types';
import {
  AnalysisDocument,
  collectWebSources,
  toReportSegments,
} from './research.utils';

/** 評価（LLM-as-a-Judge）に使うモデル。分析とは別のモデルで、主張と根拠を突き合わせる */
export const JUDGE_MODEL = 'claude-haiku-5-5';

const MAX_TOKENS = 16000;
const MAX_PAUSE_CONTINUATIONS = 3;

/** Claude に渡す会話 */
export interface TranscriptDocument {
  id: string;
  name: string;
  text: string;
}

/** ② 提案の出力（Claude が返す形） */
export interface RawProposal {
  keywords: { keyword: string; reason: string; quotes: string[] }[];
  domains: { domain: string; owner: string; reason: string }[];
}

/** ⑤ 判定の出力（Claude が返す形） */
export interface RawJudgement {
  claims: {
    index: number;
    factual: boolean;
    verdict: 'supported' | 'partial' | 'unsupported' | 'not_applicable';
    reason: string;
  }[];
  relevance: { keyword: string; answered: boolean; reason: string }[];
  ethics: {
    no_sensitive_inference: { passed: boolean; detail: string };
    no_individual_judgement: { passed: boolean; detail: string };
  };
}

/** 会話を、キャッシュ可能な文書ブロックにする（最後の会話にキャッシュ指定を付ける） */
function transcriptBlocks(
  transcripts: TranscriptDocument[],
  citations: boolean,
): Anthropic.DocumentBlockParam[] {
  return transcripts.map((t, i) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: t.text },
    title: `会話: ${t.name}`,
    ...(citations && { citations: { enabled: true } }),
    ...(i === transcripts.length - 1 && {
      cache_control: { type: 'ephemeral' as const },
    }),
  }));
}

/** ディープサーチ（調査）の各段階で Claude を呼び出すサービス */
@Injectable()
export class ResearchClaudeService {
  private readonly logger = new Logger(ResearchClaudeService.name);

  constructor(private readonly claudeClient: ClaudeClientService) {}

  /** ② 会話を読み、調べるべきキーワードと公式サイトを提案する */
  async proposeKeywords(
    transcripts: TranscriptDocument[],
    frequentWords: { word: string; count: number }[],
  ): Promise<RawProposal> {
    const response = await this.claudeClient.getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PROPOSAL_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...transcriptBlocks(transcripts, false),
            {
              type: 'text',
              text: `上の会話（ポッドキャストの文字起こし）を読み、会話で頻繁に使われ、Webで調べると理解が深まるキーワードを5〜8個提案してください。

## 会話での出現回数が多い語（参考）
${frequentWords.map((w) => `- ${w.word}（${w.count}回）`).join('\n')}

## 指示
- keyword: 会話の中で実際に使われている表記のまま書く。一般的すぎる語（AI、モデル など単独では意味が広すぎるもの）は避け、会話の論点になっている専門用語・固有名詞を選ぶ
- reason: 会話のどの話題に関係し、何を調べると良いかを1〜2文で書く
- quotes: そのキーワードが使われている発言を、会話から一字一句そのまま1〜2個抜き出す（各10〜60文字）
- domains: キーワードの公式情報を調べるべき公式サイトのドメインを提案する（例: 製品・ツールの提供元、標準化団体、カンファレンスの公式サイト）。推測で存在しないドメインを書かない
- 会話に登場する個人の評価・性格・健康・思想などには触れない`,
            },
          ],
        },
      ],
    });
    assertCompleteResponse(response);
    return JSON.parse(extractText(response.content)) as RawProposal;
  }

  /**
   * ③ 確定したキーワードを、公式サイトを中心にWebで調べる
   * 公式サイトで情報源が見つからなかった場合だけ、一般のサイトも検索する
   */
  async researchWeb(
    keywords: string[],
    domains: string[],
  ): Promise<WebSource[]> {
    const prompt = `次のキーワードについて、それぞれの公式な情報（定義、仕組み、提供元の説明）をWebで調べ、キーワードごとに要点を書いてください。各要点には、根拠となる検索結果を引用してください。

## キーワード
${keywords.map((k) => `- ${k}`).join('\n')}`;

    let sources: WebSource[] = [];
    if (domains.length > 0) {
      sources = await this.searchWeb(prompt, keywords.length, domains, domains);
    }
    if (!sources.some((s) => s.excerpts.length > 0)) {
      this.logger.log(
        '公式サイトで情報源が見つからないため、一般のサイトも検索します',
      );
      sources = await this.searchWeb(
        prompt,
        keywords.length,
        undefined,
        domains,
      );
    }
    return sources;
  }

  private async searchWeb(
    prompt: string,
    keywordCount: number,
    allowedDomains: string[] | undefined,
    officialDomains: string[],
  ): Promise<WebSource[]> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];
    const content: Anthropic.ContentBlock[] = [];
    let completed = false;
    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const response = await this.claudeClient.getClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        tools: [
          {
            // 回答に引用（citations）が付く版を使う
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: Math.min(10, keywordCount * 2),
            ...(allowedDomains && { allowed_domains: allowedDomains }),
          },
        ],
        messages,
      });
      assertCompleteResponse(response);
      content.push(...response.content);
      if (response.stop_reason !== 'pause_turn') {
        completed = true;
        break;
      }
      messages.push({ role: 'assistant', content: response.content });
    }
    if (!completed) {
      throw new Error('Web調査がpause_turnの再開上限に達しました');
    }
    return collectWebSources(content, officialDomains);
  }

  /** ④ 会話とWebの情報源を論点ごとに統合し、根拠付きで分析する */
  async analyze(
    transcripts: TranscriptDocument[],
    webSources: WebSource[],
    keywords: string[],
  ): Promise<ReportSegment[]> {
    const usableWeb = webSources.filter((s) => s.excerpts.length > 0);
    const documents: AnalysisDocument[] = [
      ...transcripts.map((t) => ({
        sourceKind: 'conversation' as const,
        sourceId: t.id,
        title: t.name,
      })),
      ...usableWeb.map((s) => ({
        sourceKind: 'web' as const,
        sourceId: s.url,
        title: s.title,
        official: s.official,
      })),
    ];
    const response = await this.claudeClient.getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: [
            ...transcriptBlocks(transcripts, true),
            ...usableWeb.map(
              (s): Anthropic.DocumentBlockParam => ({
                type: 'document',
                source: {
                  type: 'text',
                  media_type: 'text/plain',
                  data: s.excerpts.join('\n'),
                },
                title: `Web${s.official ? '（公式）' : ''}: ${s.title}`,
                context: s.url,
                citations: { enabled: true },
              }),
            ),
            {
              type: 'text',
              text: `上の会話（ポッドキャストの文字起こし）と、Webで調べた情報をもとに、次のキーワードについて論点ごとに分析してください。

## キーワード（論点）
${keywords.map((k) => `- ${k}`).join('\n')}

## 書き方
- キーワードごとに「## キーワード」の見出しを立て、その下に次の4項目を書く
  - **会話では**: 会話でどう語られたか（誰がどう主張したか）
  - **公式情報では**: Webの情報（公式サイトを優先）での説明
  - **一致・相違・不足**: 会話と公式情報で一致する点、食い違う点、どちらにも情報がない点
  - **示唆**: 会話と公式情報を合わせてわかること
- 事実を述べる文には、必ず根拠となる文書を引用する。文書に根拠がない内容は書かない。推測を書く場合は「推測:」と明記する
- 会話に登場する個人の評価・性格・健康・思想などを推測しない`,
            },
          ],
        },
      ],
    });
    assertCompleteResponse(response);
    return toReportSegments(response.content, documents);
  }

  /** ⑤ 統合分析の各文が根拠で裏付けられているか、論点に答えているか、AI倫理を満たすかを判定する */
  async judge(
    segments: ReportSegment[],
    keywords: string[],
  ): Promise<RawJudgement> {
    const claims = segments
      .map((s, index) => {
        const evidence =
          s.citations.length > 0
            ? s.citations.map((c) => `    - 「${c.citedText}」`).join('\n')
            : '    - （根拠なし）';
        return `[${index}] ${s.text.trim()}\n  根拠:\n${evidence}`;
      })
      .join('\n\n');
    const response = await this.claudeClient.getClient().messages.create({
      model: JUDGE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: JUDGEMENT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `あなたは分析レポートの審査員です。次のレポートの各文（[番号] の後）を、その文に付いている根拠だけを使って審査してください。一般知識で補って判断してはいけません。

## レポートの各文と根拠
${claims}

## 論点（キーワード）
${keywords.map((k) => `- ${k}`).join('\n')}

## 判定
- claims: すべての番号について判定する
  - factual: 事実を述べる文なら true。見出し、つなぎの文、「推測:」と明記した文は false
  - verdict: factual が true の場合、根拠が文の内容を裏付けていれば supported、一部だけなら partial、裏付けていない・根拠がなければ unsupported。factual が false なら not_applicable
  - reason: 判定の理由を1文で
- relevance: 各論点について、レポートがその論点に答えているか
- ethics:
  - no_sensitive_inference: 会話に登場する個人の性格・健康・思想・属性を推測していなければ passed=true
  - no_individual_judgement: 個人を評価・選別する記述（採用・人事などの判断材料になる記述）がなければ passed=true`,
        },
      ],
    });
    assertCompleteResponse(response);
    return JSON.parse(extractText(response.content)) as RawJudgement;
  }
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    keywords: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          reason: { type: 'string' },
          quotes: { type: 'array', items: { type: 'string' } },
        },
        required: ['keyword', 'reason', 'quotes'],
        additionalProperties: false,
      },
    },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          owner: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['domain', 'owner', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['keywords', 'domains'],
  additionalProperties: false,
};

const ETHICS_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['passed', 'detail'],
  additionalProperties: false,
};

const JUDGEMENT_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          factual: { type: 'boolean' },
          verdict: {
            type: 'string',
            enum: ['supported', 'partial', 'unsupported', 'not_applicable'],
          },
          reason: { type: 'string' },
        },
        required: ['index', 'factual', 'verdict', 'reason'],
        additionalProperties: false,
      },
    },
    relevance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          answered: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['keyword', 'answered', 'reason'],
        additionalProperties: false,
      },
    },
    ethics: {
      type: 'object',
      properties: {
        no_sensitive_inference: ETHICS_ITEM_SCHEMA,
        no_individual_judgement: ETHICS_ITEM_SCHEMA,
      },
      required: ['no_sensitive_inference', 'no_individual_judgement'],
      additionalProperties: false,
    },
  },
  required: ['claims', 'relevance', 'ethics'],
  additionalProperties: false,
};
