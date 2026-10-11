import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeClientService } from '../claude/claude-client.service';
import { CLAUDE_MODEL } from '../claude/analysis.service';
import {
  assertCompleteResponse,
  extractText,
} from '../claude/claude-response.utils';
import {
  ReportSegment,
  ResearchTarget,
  TranscriptUtterance,
  WebResearchFailure,
  WebSource,
} from './types/research.types';
import {
  AnalysisDocument,
  collectWebSources,
  isOfficial,
  mergeWebSources,
  needsGeneralSearch,
  parseDefinitionFound,
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
  /** 発言（統合分析で、発言ごとに引用できるよう1発言を1ブロックにして渡す） */
  utterances: TranscriptUtterance[];
}

/** ② 提案の出力（Claude が返す形） */
export interface RawProposal {
  keywords: {
    keyword: string;
    reason: string;
    quotes: string[];
    domains: { domain: string; owner: string; reason: string }[];
  }[];
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

/**
 * 統合分析用に、会話を1発言1ブロックの文書にする
 * 文字起こしは句点が少なく、全文を1つの文章として渡すと引用が会話全体になるため、発言ごとに引用できるようにする
 */
function transcriptContentBlocks(
  transcripts: TranscriptDocument[],
): Anthropic.DocumentBlockParam[] {
  return transcripts.map((t, i) => ({
    type: 'document',
    source: {
      type: 'content',
      content: t.utterances.map((u) => ({
        type: 'text' as const,
        text: `${u.speakerName}: ${u.text}`,
      })),
    },
    title: `会話: ${t.name}`,
    citations: { enabled: true },
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
    const response = await this.claudeClient.createMessage({
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
- domains: そのキーワードの公式情報を調べるべき公式サイトのドメインを1〜3件提案する（例: 製品・ツールの提供元、提唱した組織、標準化団体、論文の公開先）。owner は運営者、reason はそのサイトで何がわかるかを1文で。推測で存在しないドメインを書かない
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
   * ③ キーワードごとに、選んだ公式サイトに限定して Web を調べる（キーワードごとの検索は同時に行う）
   * 公式サイトで十分な情報が見つからないキーワードと、公式サイトを選ばなかったキーワードは、一般のサイトも調べる
   * 一部のキーワードの調査に失敗しても、ほかのキーワードの結果で続ける（失敗したキーワードは failures で返す）
   * すべてのキーワードで失敗した場合と、失敗があり残りのキーワードでも抜粋が1つもない場合は、
   * 分析に使える情報がないため例外を投げる
   */
  async researchWeb(
    targets: ResearchTarget[],
  ): Promise<{ sources: WebSource[]; failures: WebResearchFailure[] }> {
    const results = await Promise.allSettled(
      targets.map((t) => this.researchKeyword(t.keyword, t.domains)),
    );
    const failures: WebResearchFailure[] = [];
    const sources: WebSource[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        sources.push(...result.value);
        return;
      }
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      this.logger.warn(`「${targets[i].keyword}」の Web調査に失敗: ${error}`);
      failures.push({ keyword: targets[i].keyword, error });
    });
    if (failures.length === targets.length) {
      throw new Error(
        `すべてのキーワードで Web調査に失敗しました: ${failures[0].error}`,
      );
    }
    if (failures.length > 0 && !sources.some((s) => s.excerpts.length > 0)) {
      throw new Error(
        `Web調査で分析に使える情報源が見つかりませんでした（失敗したキーワード: ${failures
          .map((f) => f.keyword)
          .join('、')}）: ${failures[0].error}`,
      );
    }
    return { sources: mergeWebSources(sources), failures };
  }

  private async researchKeyword(
    keyword: string,
    domains: string[],
  ): Promise<WebSource[]> {
    const prompt = `キーワード「${keyword}」を詳しく解説するために、公式な情報をWebで調べ、要点を書いてください。定義、構成要素・仕組み、具体例や使いどころ、注意点や限界を探してください。各要点には、根拠となる検索結果を引用してください。`;
    if (domains.length === 0) {
      return (await this.searchWeb(prompt, 1, undefined, domains)).sources;
    }
    // 公式サイトの情報だけでキーワードの定義がわかったかを、最後の行に書かせる
    const official = await this.searchWeb(
      `${prompt}\n最後の行に、検索結果だけでキーワードの定義（何であるか）がわかった場合は「定義: あり」、わからなかった場合は「定義: なし」と書いてください。`,
      1,
      domains,
      domains,
    );
    const definitionFound = parseDefinitionFound(official.text);
    if (!needsGeneralSearch(official.sources, definitionFound)) {
      return official.sources;
    }
    this.logger.log(
      `「${keyword}」は公式サイトの情報が足りないため、一般のサイトも検索します（定義: ${
        definitionFound === null ? '不明' : definitionFound ? 'あり' : 'なし'
      }）`,
    );
    // 公式サイトの情報は残し、一般のサイトの情報を足す（公式サイトのページは一般の検索でも公式とする）
    const general = await this.searchWeb(prompt, 1, undefined, domains);
    return [...official.sources, ...general.sources];
  }

  private async searchWeb(
    prompt: string,
    keywordCount: number,
    allowedDomains: string[] | undefined,
    officialDomains: string[],
  ): Promise<{ sources: WebSource[]; text: string }> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];
    const content: Anthropic.ContentBlock[] = [];
    let completed = false;
    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const response = await this.claudeClient.createMessage({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        tools: [
          {
            // 回答に引用（citations）が付く版を使う
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: Math.min(12, keywordCount * 3),
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
    const sources = collectWebSources(content, officialDomains);
    // allowed_domains を指定しても、ほかのサイトの検索結果が返ることがあるため、選んだサイトのものだけを残す
    return {
      sources: allowedDomains
        ? sources.filter((s) => isOfficial(s.url, allowedDomains))
        : sources,
      text: extractText(content),
    };
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
        utterances: t.utterances,
      })),
      ...usableWeb.map((s) => ({
        sourceKind: 'web' as const,
        sourceId: s.url,
        title: s.title,
        official: s.official,
      })),
    ];
    const response = await this.claudeClient.createMessage({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: [
            ...transcriptContentBlocks(transcripts),
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
              text: `上の会話（ポッドキャストの文字起こし）で話題になった次のキーワードについて、Webで調べた情報をもとに、詳しく解説してください。目的は会話の内容をまとめることではなく、キーワードそのものを理解できるようにすることです。

## キーワード
${keywords.map((k) => `- ${k}`).join('\n')}

## 書き方
- キーワードごとに「## キーワード」の見出しを立て（見出しはキーワードをそのまま書く）、その下に次の項目を書く
  - **一言でいうと**: キーワードの定義を1〜2文で
  - **詳しく**: 構成要素・仕組み・具体例や使いどころ・注意点や限界を、箇条書きで（情報がない観点は書かない）
  - **会話での説明との違い**: 会話での説明が Web の情報と食い違う場合だけ、どこがどう違うかを1〜2文で書く。食い違いがなければ、この項目は見出しごと書かない（「食い違いはない」「一致している」とも書かない）
  - **関連するキーワード**: 理解の助けになる関連用語を、読点区切りで1行に
- 「一言でいうと」「詳しく」は Web の情報だけをもとに書き、各文に Web の文書を引用する。会話の内容は書かない
- 「会話での説明との違い」の文は、比べた会話の発言と Web の情報の両方を引用する
- 文書に根拠がない内容は書かない。推測を書く場合は「推測:」と明記する
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
    const response = await this.claudeClient.createMessage({
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
  - factual: 事実を述べる文なら true。見出し、つなぎの文、「推測:」と明記した文は false。「不足:」で始まる文や、「提供された文書に記載がない」「公式情報では確認できない」のように、根拠がないこと自体を述べる文も false
  - verdict: factual が true の場合、根拠が文の内容を裏付けていれば supported、一部だけなら partial、裏付けていない・根拠がなければ unsupported。factual が false なら not_applicable
  - reason: 判定の理由を1文で
- relevance: 各キーワードについて、レポートが Web の情報でそのキーワードを説明しているか（定義と詳しい説明があるか）
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
        required: ['keyword', 'reason', 'quotes', 'domains'],
        additionalProperties: false,
      },
    },
  },
  required: ['keywords'],
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
