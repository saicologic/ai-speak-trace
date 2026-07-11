import { Test, TestingModule } from '@nestjs/testing';
import { FaithfulnessCheckerService } from './faithfulness-checker.service';
import { ClaudeClientService } from './claude-client.service';

const mockMessagesCreate = jest.fn();
const mockClaudeClientService = {
  getClient: () => ({ messages: { create: mockMessagesCreate } }),
};

function makeResponse(score: number, reason: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ score, reason }) }],
    stop_reason: 'end_turn',
  };
}

describe('FaithfulnessCheckerService', () => {
  let service: FaithfulnessCheckerService;

  beforeEach(async () => {
    mockMessagesCreate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaithfulnessCheckerService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
      ],
    }).compile();

    service = module.get<FaithfulnessCheckerService>(FaithfulnessCheckerService);
  });

  describe('check', () => {
    it('スコア0.8を返したとき passed=true になる', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.8, '根拠あり'));

      const result = await service.check('質問', '回答', ['ソース1']);

      expect(result.score).toBe(0.8);
      expect(result.passed).toBe(true);
      expect(result.reason).toBe('根拠あり');
    });

    it('スコア0.5を返したとき passed=false になる（閾値0.7未満）', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.5, 'ソース外情報あり'));

      const result = await service.check('質問', '回答', ['ソース1']);

      expect(result.score).toBe(0.5);
      expect(result.passed).toBe(false);
    });

    it('スコアが閾値ちょうど（0.7）のとき passed=true になる', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.7, 'ちょうど閾値'));

      const result = await service.check('質問', '回答', ['ソース1']);

      expect(result.passed).toBe(true);
    });

    it('ソースが空のとき Claude を呼ばずに passed=false を返す', async () => {
      const result = await service.check('質問', '回答', []);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
    });

    it('回答が空のとき Claude を呼ばずに passed=false を返す', async () => {
      const result = await service.check('質問', '', ['ソース1']);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.passed).toBe(false);
    });

    it('Claude がJSONを返さないときチェックをスキップして passed=true を返す', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'JSONなし' }],
        stop_reason: 'end_turn',
      });

      const result = await service.check('質問', '回答', ['ソース1']);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('Claude 呼び出しが失敗したときチェックをスキップして passed=true を返す', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('API error'));

      const result = await service.check('質問', '回答', ['ソース1']);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('採点に claude-sonnet-4-6 を使用する', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.9, '根拠あり'));

      await service.check('質問', '回答', ['ソース1']);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('validateOrFallback', () => {
    it('passed=true のとき元の回答をそのまま返す', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.9, '根拠あり'));

      const result = await service.validateOrFallback('質問', '元の回答', ['ソース1']);

      expect(result).toBe('元の回答');
    });

    it('passed=false のときフォールバックメッセージを返す', async () => {
      mockMessagesCreate.mockResolvedValue(makeResponse(0.3, 'ソース外情報多数'));

      const result = await service.validateOrFallback('質問', '元の回答', ['ソース1']);

      expect(result).not.toBe('元の回答');
      expect(result).toContain('提供された情報では');
    });
  });
});
