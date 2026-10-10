import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService, CLAUDE_MODEL } from './analysis.service';
import { ClaudeClientService } from './claude-client.service';

/** Anthropic messages.create のモック */
const mockMessagesCreate = jest.fn();
const mockClaudeClientService = {
  getClient: () => ({
    messages: {
      create: mockMessagesCreate,
    },
  }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  describe('analyzeSearchResults', () => {
    it('先頭がthinkingブロックでも本文のテキストを返す', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: '分析レポート' },
        ],
        stop_reason: 'end_turn',
      });

      const result = await service.analyzeSearchResults(['AI'], []);

      expect(result).toBe('分析レポート');
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: CLAUDE_MODEL,
          output_config: { effort: 'medium' },
        }),
      );
    });

    it('応答が拒否された場合は例外を投げる', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [],
        stop_reason: 'refusal',
      });

      await expect(service.analyzeSearchResults(['AI'], [])).rejects.toThrow(
        '拒否',
      );
    });
  });

  describe('searchAndAnalyze', () => {
    it('Web検索の回答テキストと参照元を返す', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          searchResult('記事A', 'https://example.com/a'),
          { type: 'text', text: '調査結果' },
        ],
        stop_reason: 'end_turn',
      });

      const result = await service.searchAndAnalyze(['AI'], '質問');

      expect(result).toEqual({
        answer: '調査結果',
        sources: [
          { title: '記事A', url: 'https://example.com/a', excerpts: [] },
        ],
      });
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
          ],
        }),
      );
    });

    it('pause_turnで中断されたら応答を履歴に足して再開し、両方の結果をまとめる', async () => {
      const firstContent = [searchResult('記事A', 'https://example.com/a')];
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

      const result = await service.searchAndAnalyze(['AI'], '質問');

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

      const result = await service.searchAndAnalyze(['AI'], '質問');

      expect(result).toEqual({ answer: '調査結果', sources: [] });
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

      const result = await service.searchAndAnalyze(['AI'], '質問');

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
