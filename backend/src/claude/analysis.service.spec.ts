import type Anthropic from '@anthropic-ai/sdk';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService, mergeWarnings } from './analysis.service';
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

/** Web検索結果ブロックを作るヘルパー */
function searchResult(title: string, url: string) {
  return {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_1',
    content: [{ type: 'web_search_result', title, url }],
  };
}

describe('AnalysisService', () => {
  let service: AnalysisService;

  beforeEach(async () => {
    mockMessagesCreate.mockReset();
    mockCreateMessageWithReport.mockClear();
    mockWarnings = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  describe('analyze（会話分析）', () => {
    it('会話分析のWeb検索は新しい版のツールを使う', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '回答' }],
        stop_reason: 'end_turn',
      });

      await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe('Guardrails の確認に渡すオプション', () => {
    /** tool_result で渡した内容の data を取り出す */
    const toolResultData = (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): unknown => {
      const block = params.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find(
          (b) => b.type === 'tool_result',
        ) as Anthropic.ToolResultBlockParam;
      return (JSON.parse(block.content as string) as { data: unknown }).data;
    };
    /** 最後の user の指示 */
    const lastUserText = (params: Anthropic.MessageCreateParamsNonStreaming) =>
      params.messages[params.messages.length - 1].content as string;

    const textResponse = (text: string) => ({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    });

    it('会話分析は、質問・話者名・キーワードを外からの内容として渡す', async () => {
      mockMessagesCreate.mockResolvedValue(textResponse('回答'));

      await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(mockCreateMessageWithReport).toHaveBeenCalledWith(
        expect.anything(),
        { purpose: 'analysis', untrusted: ['質問', 'Aさん', 'AI'] },
      );
    });

    it('質問の生成は、話者名とキーワードを指示と分けて tool_result で渡す', async () => {
      mockMessagesCreate.mockResolvedValue(textResponse('【AI】質問'));

      await service.generateQuestions(['AI'], 'Aさん');

      const [params, options] = mockCreateMessageWithReport.mock.calls[
        mockCreateMessageWithReport.mock.calls.length - 1
      ] as [Anthropic.MessageCreateParamsNonStreaming, unknown];
      expect(options).toEqual({ purpose: 'analysis-questions', untrusted: [] });
      expect(toolResultData(params)).toEqual({
        speakerName: 'Aさん',
        keywords: ['AI'],
      });
      expect(lastUserText(params)).not.toContain('Aさん');
    });

    it('発言の文脈は、会話の各行を外からの内容として渡し、警告を返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        textResponse('[{"index":0,"intent":"質問","topic":"進捗"}]'),
      );
      mockWarnings = [{ type: 'INSULTS', confidence: 'MEDIUM' }];

      const result = await service.analyzeContext(
        [{ speakerName: 'Aさん', text: 'どうですか' }],
        [0],
      );

      const [params, options] = mockCreateMessageWithReport.mock.calls[
        mockCreateMessageWithReport.mock.calls.length - 1
      ] as [Anthropic.MessageCreateParamsNonStreaming, unknown];
      expect(options).toEqual({ purpose: 'context', untrusted: [] });
      expect(toolResultData(params)).toEqual({
        utterances: [{ index: 0, speakerName: 'Aさん', text: 'どうですか' }],
      });
      expect(lastUserText(params)).not.toContain('どうですか');
      expect(result).toEqual({
        results: [{ index: 0, intent: '質問', topic: '進捗' }],
        warnings: [{ type: 'INSULTS', confidence: 'MEDIUM' }],
      });
    });

    it('会話分析の警告は、質問をまたいで種類ごとに1件にまとめる', async () => {
      mockMessagesCreate.mockResolvedValue(textResponse('回答'));
      mockWarnings = [{ type: 'INSULTS', confidence: 'MEDIUM' }];

      const { warnings } = await service.analyze(
        ['質問1', '質問2'],
        ['AI'],
        'Aさん',
      );

      expect(warnings).toEqual([{ type: 'INSULTS', confidence: 'MEDIUM' }]);
    });
  });

  describe('mergeWarnings', () => {
    it('同じ種類は信頼度の高い方を残す', () => {
      expect(
        mergeWarnings([
          { type: 'INSULTS', confidence: 'HIGH' },
          { type: 'INSULTS', confidence: 'MEDIUM' },
          { type: 'VIOLENCE', confidence: 'MEDIUM' },
        ]),
      ).toEqual([
        { type: 'INSULTS', confidence: 'HIGH' },
        { type: 'VIOLENCE', confidence: 'MEDIUM' },
      ]);
    });
  });

  describe('analyze（Web検索の結果のまとめ方）', () => {
    it('Web検索の回答テキストと参照元を返す', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          searchResult('記事A', 'https://example.com/a'),
          { type: 'text', text: '調査結果' },
        ],
        stop_reason: 'end_turn',
      });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(result).toEqual({
        question: '質問',
        answer: '調査結果',
        sources: [
          { title: '記事A', url: 'https://example.com/a', excerpts: [] },
        ],
      });
    });

    it('pause_turnで中断されたら応答を履歴に足して再開し、両方の結果をまとめる', async () => {
      const firstContent = [
        { type: 'text', text: '検索します。' },
        searchResult('記事A', 'https://example.com/a'),
      ];
      mockMessagesCreate
        .mockResolvedValueOnce({
          content: firstContent,
          stop_reason: 'pause_turn',
        })
        .mockResolvedValueOnce({
          content: [
            searchResult('記事B', 'https://example.com/b'),
            { type: 'text', text: '調査結果' },
          ],
          stop_reason: 'end_turn',
        });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
      const secondCall = mockMessagesCreate.mock.calls[1][0] as {
        messages: { role: string; content: unknown }[];
      };
      expect(secondCall.messages[1]).toEqual({
        role: 'assistant',
        content: firstContent,
      });
      expect(result.sources.map((s) => s.title)).toEqual(['記事A', '記事B']);
      expect(result.answer).toBe('調査結果');
    });

    it('再開上限に達してもpause_turnのままなら、途中までの回答を使わない', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '途中までの回答' }],
        stop_reason: 'pause_turn',
      });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(result.answer).toBe('分析中にエラーが発生しました。');
      // 初回 + 再開3回
      expect(mockMessagesCreate).toHaveBeenCalledTimes(4);
    });

    it('空の引用本文は抜粋に含めない', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '回答。',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://example.com/a',
                title: '記事A',
                cited_text: '  ',
                encrypted_index: 'idx',
              },
            ],
          },
        ],
        stop_reason: 'end_turn',
      });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(result.sources).toEqual([
        { title: '記事A', url: 'https://example.com/a', excerpts: [] },
      ]);
    });

    it('Web検索がエラーを返しても参照元なしで回答を返す', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: {
              type: 'web_search_tool_result_error',
              error_code: 'max_uses_exceeded',
            },
          },
          { type: 'text', text: '調査結果' },
        ],
        stop_reason: 'end_turn',
      });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(result).toEqual({
        question: '質問',
        answer: '調査結果',
        sources: [],
      });
    });

    it('回答の引用（citations）から記事ごとに引用本文を集める', async () => {
      const citation = (url: string, title: string, citedText: string) => ({
        type: 'web_search_result_location',
        url,
        title,
        cited_text: citedText,
        encrypted_index: 'idx',
      });
      mockMessagesCreate.mockResolvedValue({
        content: [
          searchResult('記事A', 'https://example.com/a'),
          {
            type: 'text',
            text: '前半。',
            citations: [
              citation('https://example.com/a', '記事A', '引用1'),
              citation('https://example.com/c', '記事C', '引用3'),
            ],
          },
          {
            type: 'text',
            text: '後半。',
            citations: [
              citation('https://example.com/a', '記事A', '引用2'),
              citation('https://example.com/a', '記事A', '引用1'),
            ],
          },
          { type: 'text', text: '引用なし。', citations: null },
        ],
        stop_reason: 'end_turn',
      });

      const {
        results: [result],
      } = await service.analyze(['質問'], ['AI'], 'Aさん');

      expect(result.answer).toBe('前半。後半。引用なし。');
      expect(result.sources).toEqual([
        {
          title: '記事A',
          url: 'https://example.com/a',
          excerpts: ['引用1', '引用2'],
        },
        {
          title: '記事C',
          url: 'https://example.com/c',
          excerpts: ['引用3'],
        },
      ]);
    });
  });
});
