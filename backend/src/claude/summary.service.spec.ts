import { Test, TestingModule } from '@nestjs/testing';
import { SummaryService } from './summary.service';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
      ],
    }).compile();

    service = module.get<SummaryService>(SummaryService);
  });

  describe('summarize', () => {
    it('Claudeから正常なJSONが返ったときパースして返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeResponse({
          overview: '概要',
          key_points: [{ topic: 'テーマ', summary: '要点' }],
          decisions: ['決定1'],
        }),
      );

      const result = await service.summarize('会話テキスト');

      expect(result.overview).toBe('概要');
      expect(result.key_points).toEqual([{ topic: 'テーマ', summary: '要点' }]);
      expect(result.decisions).toEqual(['決定1']);
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
        stop_reason: 'max_tokens',
      });

      await expect(service.summarize('会話テキスト')).rejects.toThrow(
        '要約結果のパースに失敗しました',
      );
    });

    it('{{fullText}} が会話全文に置換されてClaudeに渡される', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse({ overview: '概要', key_points: [], decisions: [] }));

      await service.summarize('実際の会話内容', 'claude-sonnet-4-6', '要約してください: {{fullText}}');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: '要約してください: 実際の会話内容' }],
        }),
      );
    });
  });
});
