import type Anthropic from '@anthropic-ai/sdk';
import { BadRequestException } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';
import {
  GuardrailFindings,
  GuardrailService,
} from '../privacy/guardrail.service';

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
);

const noFindings = (): GuardrailFindings => ({
  pii: [],
  words: [],
  content: [],
});

function textResponse(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
  } as unknown as Anthropic.Message;
}

const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-sonnet-5-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: '連絡先は 090-1234-5678 です' }],
};

describe('ClaudeClientService.createMessage', () => {
  let guardrail: {
    isConfigured: jest.Mock;
    inspect: jest.Mock;
  };
  let service: ClaudeClientService;

  beforeEach(() => {
    mockCreate.mockReset();
    guardrail = {
      isConfigured: jest.fn().mockReturnValue(true),
      inspect: jest.fn().mockResolvedValue(noFindings()),
    };
    service = new ClaudeClientService(guardrail as unknown as GuardrailService);
  });

  it('Guardrail ID が未設定なら Claude に送らない', async () => {
    guardrail.isConfigured.mockReturnValue(false);
    await expect(service.createMessage(params)).rejects.toThrow(
      BadRequestException,
    );
    expect(guardrail.inspect).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('プロンプト攻撃が検出されたら Claude に送らない', async () => {
    guardrail.inspect.mockResolvedValueOnce({
      ...noFindings(),
      content: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH' }],
    });
    await expect(service.createMessage(params)).rejects.toThrow(
      'プロンプト攻撃',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('Guardrails のチェックに失敗したら Claude に送らない', async () => {
    guardrail.inspect.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(service.createMessage(params)).rejects.toThrow('AccessDenied');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('送る内容をすべての文字のチェックを求めて INPUT で確認する', async () => {
    mockCreate.mockResolvedValue(textResponse('了解しました'));
    await service.createMessage(params);
    expect(guardrail.inspect).toHaveBeenNthCalledWith(
      1,
      '連絡先は 090-1234-5678 です',
      'INPUT',
      { requireFullCoverage: true },
    );
  });

  it('連絡先などの個人情報は伏せて送り、氏名など誤検出の多い種類は伏せない', async () => {
    guardrail.inspect.mockResolvedValueOnce({
      ...noFindings(),
      pii: [
        { type: 'PHONE', match: '090-1234-5678' },
        { type: 'NAME', match: '連絡先' },
      ],
    });
    mockCreate.mockResolvedValue(textResponse('了解しました'));
    await service.createMessage(params);
    const [[sent]] = mockCreate.mock.calls as [
      [Anthropic.MessageCreateParamsNonStreaming],
    ];
    expect(sent.messages[0].content).toBe('連絡先は [電話番号] です');
  });

  it('応答を OUTPUT で確認し、連絡先などの個人情報を伏せて返す', async () => {
    mockCreate.mockResolvedValue(textResponse('窓口は a@example.com です'));
    guardrail.inspect
      .mockResolvedValueOnce(noFindings())
      .mockResolvedValueOnce({
        ...noFindings(),
        pii: [{ type: 'EMAIL', match: 'a@example.com' }],
      });
    const response = await service.createMessage(params);
    expect(guardrail.inspect).toHaveBeenNthCalledWith(
      2,
      '窓口は a@example.com です',
      'OUTPUT',
      { requireFullCoverage: true },
    );
    expect(response.content[0]).toMatchObject({
      text: '窓口は [メールアドレス] です',
    });
  });

  it('チェックできない内容（画像）が含まれていたら Claude に送らない', async () => {
    await expect(
      service.createMessage({
        ...params,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/a.png' },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('チェックできない内容');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
