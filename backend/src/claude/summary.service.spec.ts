import { Test, TestingModule } from '@nestjs/testing';
import type Anthropic from '@anthropic-ai/sdk';
import { FULL_TEXT_REFERENCE, SummaryService } from './summary.service';
import { ClaudeClientService } from './claude-client.service';

/** Claude に送った内容と、応答のモック（ClaudeClientService.createMessageWithReport の中身） */
const mockMessagesCreate = jest.fn();
/** 応答に検出された警告のモック */
let mockWarnings: { type: string; confidence: string }[] = [];
const mockCreateMessageWithReport = jest.fn(
  async (params: unknown, options: unknown) => ({
    message: (await mockMessagesCreate(params, options)) as unknown,
    warnings: mockWarnings,
  }),
);
const mockClaudeClientService = {
  createMessageWithReport: mockCreateMessageWithReport,
};

/** 正常なJSONレスポンスを返すヘルパー */
function makeResponse(json: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    stop_reason: 'end_turn',
  };
}

describe('SummaryService', () => {
  let service: SummaryService;

  beforeEach(async () => {
    mockMessagesCreate.mockReset();
    mockCreateMessageWithReport.mockClear();
    mockWarnings = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
      ],
    }).compile();

    service = module.get<SummaryService>(SummaryService);
  });

  describe('summarize', () => {
    it('先頭がthinkingブロックでもJSONを取り出してパースする', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: JSON.stringify({ overview: '概要' }) },
        ],
        stop_reason: 'end_turn',
      });

      const { summary } = await service.summarize('会話');

      expect(summary.overview).toBe('概要');
    });

    it('応答が拒否された場合は例外を投げる', async () => {
      mockMessagesCreate.mockResolvedValue({ content: [], stop_reason: 'refusal' });

      await expect(service.summarize('会話')).rejects.toThrow('拒否');
    });

    it('Claudeから正常なJSONが返ったときパースして返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeResponse({
          overview: '概要',
          key_points: [{ topic: 'テーマ', summary: '要点' }],
          decisions: ['決定1'],
        }),
      );

      const { summary } = await service.summarize('会話テキスト');

      expect(summary.overview).toBe('概要');
      expect(summary.key_points).toEqual([{ topic: 'テーマ', summary: '要点' }]);
      expect(summary.decisions).toEqual(['決定1']);
    });

    it('レスポンスにJSONが含まれないとき要約パースエラーをスロー', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'JSONなし。テキストのみ。' }],
        stop_reason: 'end_turn',
      });

      await expect(service.summarize('会話テキスト')).rejects.toThrow(
        '要約結果のパースに失敗しました',
      );
    });

    it('JSONが壊れているときパースエラーをスロー', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{ "overview": "未完了の' }],
        stop_reason: 'end_turn',
      });

      await expect(service.summarize('会話テキスト')).rejects.toThrow(
        '要約結果のパースに失敗しました',
      );
    });

    it('出力が上限で途中で切れたときは、その旨のエラーをスロー', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{ "overview": "未完了の' }],
        stop_reason: 'max_tokens',
      });

      await expect(service.summarize('会話テキスト')).rejects.toThrow(
        '上限に達したため',
      );
    });

    /** Claude に渡したリクエスト */
    const sentParams = () =>
      mockCreateMessageWithReport.mock.calls[
        mockCreateMessageWithReport.mock.calls.length - 1
      ][0] as Anthropic.MessageCreateParamsNonStreaming;
    /** tool_result で渡した会話の全文 */
    const sentConversation = (): unknown => {
      const block = sentParams()
        .messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find(
          (b) => b.type === 'tool_result',
        ) as Anthropic.ToolResultBlockParam;
      const parsed = JSON.parse(block.content as string) as {
        data: { conversation: unknown };
      };
      return parsed.data.conversation;
    };
    /** 最後の user の指示 */
    const sentInstructions = () => {
      const messages = sentParams().messages;
      return messages[messages.length - 1].content;
    };

    it('会話の全文は指示と分けて tool_result で渡し、{{fullText}} はその在りかの文に置き換える', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse({ overview: '概要', key_points: [], decisions: [] }));

      await service.summarize('実際の会話内容', 'claude-sonnet-5-5', '要約してください: {{fullText}}');

      expect(sentConversation()).toBe('実際の会話内容');
      expect(sentInstructions()).toBe(`要約してください: ${FULL_TEXT_REFERENCE}`);
      expect(sentParams().tool_choice).toEqual({ type: 'none' });
    });

    it('プロンプト攻撃は tool_result で渡した会話だけで確認させる', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse({ overview: '概要' }));

      await service.summarize('実際の会話内容', 'claude-sonnet-5-5', '要約: {{fullText}}');

      expect(mockCreateMessageWithReport).toHaveBeenCalledWith(
        expect.anything(),
        { purpose: 'summary', untrusted: [] },
      );
    });

    it('会話に $& などの置換パターンが含まれていても、そのまま渡す', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse({ overview: '概要' }));

      await service.summarize('価格は $& です', 'claude-sonnet-5-5', '要約: {{fullText}}');

      expect(sentConversation()).toBe('価格は $& です');
    });

    it('応答に検出された警告を返す', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse({ overview: '概要' }));
      mockWarnings = [{ type: 'VIOLENCE', confidence: 'MEDIUM' }];

      const { warnings } = await service.summarize('会話');

      expect(warnings).toEqual([{ type: 'VIOLENCE', confidence: 'MEDIUM' }]);
    });

    it('既定のプロンプトは、要点ごとに根拠の発言の引用を求める', () => {
      expect(SummaryService.DEFAULT_SUMMARY_PROMPT).toContain('evidence');
    });
  });
});
