import type Anthropic from '@anthropic-ai/sdk';
import { BadRequestException } from '@nestjs/common';
import {
  ClaudeClientService,
  ETHICS_SYSTEM_PROMPT,
  withEthicsSystem,
} from './claude-client.service';
import { ClaudeAuditRecord, ClaudeAuditStore } from './claude-audit.store';
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
    guardrailId: string;
    guardrailVersion: string;
  };
  let auditStore: { append: jest.Mock };
  let service: ClaudeClientService;

  /** 最後に記録した呼び出し */
  const lastAudit = () =>
    auditStore.append.mock.calls.at(-1)?.[0] as ClaudeAuditRecord;

  beforeEach(() => {
    mockCreate.mockReset();
    guardrail = {
      isConfigured: jest.fn().mockReturnValue(true),
      inspect: jest.fn().mockResolvedValue(noFindings()),
      guardrailId: 'gr-1',
      guardrailVersion: '2',
    };
    auditStore = { append: jest.fn().mockResolvedValue(undefined) };
    service = new ClaudeClientService(
      guardrail as unknown as GuardrailService,
      auditStore as unknown as ClaudeAuditStore,
    );
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

  it('伏せられない部分（検索語）に伏せる対象の個人情報があれば Claude に送らない', async () => {
    guardrail.inspect.mockResolvedValueOnce({
      ...noFindings(),
      pii: [{ type: 'EMAIL', match: 'a@example.com' }],
    });
    await expect(
      service.createMessage({
        ...params,
        messages: [
          { role: 'user', content: '調べて' },
          {
            role: 'assistant',
            content: [
              {
                type: 'server_tool_use',
                id: 's1',
                name: 'web_search',
                input: { query: 'a@example.com' },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('伏せられない部分');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('応答の伏せられない部分（検索結果の題名）に伏せる対象の個人情報があれば、応答を返さない', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'web_search_tool_result',
          tool_use_id: 's1',
          content: [
            {
              type: 'web_search_result',
              title: '連絡先 090-1234-5678',
              url: 'https://example.com',
              encrypted_content: 'enc',
            },
          ],
        },
      ],
      stop_reason: 'end_turn',
    });
    guardrail.inspect
      .mockResolvedValueOnce(noFindings())
      .mockResolvedValueOnce({
        ...noFindings(),
        pii: [{ type: 'PHONE', match: '090-1234-5678' }],
      });
    await expect(service.createMessage(params)).rejects.toThrow(
      '応答を使いませんでした',
    );
    expect(guardrail.inspect).toHaveBeenNthCalledWith(
      2,
      '連絡先 090-1234-5678',
      'OUTPUT',
      { requireFullCoverage: true },
    );
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

  it('system の先頭に AI倫理の指示を付けて送る（Guardrails の確認には含めない）', async () => {
    mockCreate.mockResolvedValue(textResponse('了解しました'));
    await service.createMessage({ ...params, system: 'あなたは要約係です' });
    const [[sent]] = mockCreate.mock.calls as [
      [Anthropic.MessageCreateParamsNonStreaming],
    ];
    expect(sent.system).toEqual([
      { type: 'text', text: ETHICS_SYSTEM_PROMPT },
      { type: 'text', text: 'あなたは要約係です' },
    ]);
    expect(guardrail.inspect.mock.calls[0][0]).not.toContain(
      ETHICS_SYSTEM_PROMPT,
    );
  });

  it('応答に信頼度 HIGH の不適切な表現が検出されたら、応答を使わない', async () => {
    mockCreate.mockResolvedValue(textResponse('ひどい言葉'));
    guardrail.inspect
      .mockResolvedValueOnce(noFindings())
      .mockResolvedValueOnce({
        ...noFindings(),
        content: [{ type: 'INSULTS', confidence: 'HIGH' }],
      });
    await expect(service.createMessage(params)).rejects.toThrow(
      '不適切な表現（侮辱）',
    );
    expect(lastAudit()).toMatchObject({
      outcome: 'blocked_output',
      output: { content: [{ type: 'INSULTS', confidence: 'HIGH' }] },
    });
  });

  it('応答に信頼度 MEDIUM の不適切な表現が検出されたら、警告として返す', async () => {
    mockCreate.mockResolvedValue(textResponse('強い言葉'));
    guardrail.inspect
      .mockResolvedValueOnce(noFindings())
      .mockResolvedValueOnce({
        ...noFindings(),
        content: [
          { type: 'VIOLENCE', confidence: 'MEDIUM' },
          { type: 'MISCONDUCT', confidence: 'LOW' },
        ],
      });
    const { message, warnings } = await service.createMessageWithReport(params);
    expect(message.content[0]).toMatchObject({ text: '強い言葉' });
    expect(warnings).toEqual([{ type: 'VIOLENCE', confidence: 'MEDIUM' }]);
  });

  it('送って応答を返した呼び出しを、検出した文字列を残さずに記録する', async () => {
    guardrail.inspect.mockResolvedValueOnce({
      ...noFindings(),
      pii: [{ type: 'PHONE', match: '090-1234-5678' }],
    });
    mockCreate.mockResolvedValue(textResponse('了解しました'));
    await service.createMessage(params, { purpose: 'summary' });
    const record = lastAudit();
    expect(record).toMatchObject({
      purpose: 'summary',
      model: 'claude-sonnet-5-5',
      guardrailId: 'gr-1',
      guardrailVersion: '2',
      outcome: 'sent',
      input: { piiTypes: { PHONE: 1 }, masked: 1, content: [] },
      output: { piiTypes: {}, masked: 0, content: [] },
    });
    expect(JSON.stringify(record)).not.toContain('090-1234-5678');
  });

  it('プロンプト攻撃で止めた呼び出しを記録する', async () => {
    guardrail.inspect.mockResolvedValueOnce({
      ...noFindings(),
      content: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH' }],
    });
    await expect(service.createMessage(params)).rejects.toThrow();
    expect(lastAudit()).toMatchObject({
      purpose: 'other',
      outcome: 'blocked_input',
    });
  });

  it('Guardrails の確認に失敗した呼び出しを、エラーとして記録する', async () => {
    guardrail.inspect.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(service.createMessage(params)).rejects.toThrow();
    expect(lastAudit()).toMatchObject({
      outcome: 'error',
      reason: 'AccessDenied',
    });
  });

  describe('外からの内容（untrusted）を指定した場合', () => {
    const summaryParams: Anthropic.MessageCreateParamsNonStreaming = {
      ...params,
      messages: [
        { role: 'user', content: '次の会話を要約して。\n会話: こんにちは' },
      ],
    };

    it('アプリの指示と外からの内容を分けて確認する', async () => {
      mockCreate.mockResolvedValue(textResponse('要約'));
      await service.createMessage(summaryParams, {
        untrusted: ['こんにちは'],
      });
      expect(guardrail.inspect.mock.calls.slice(0, 2)).toEqual([
        [
          '次の会話を要約して。\n会話: \n',
          'INPUT',
          { requireFullCoverage: true },
        ],
        ['こんにちは', 'INPUT', { requireFullCoverage: true }],
      ]);
    });

    it('アプリの指示のプロンプト攻撃の検出では止めない', async () => {
      guardrail.inspect
        .mockResolvedValueOnce({
          ...noFindings(),
          content: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH' }],
        })
        .mockResolvedValueOnce(noFindings());
      mockCreate.mockResolvedValue(textResponse('要約'));
      await expect(
        service.createMessage(summaryParams, { untrusted: ['こんにちは'] }),
      ).resolves.toBeDefined();
    });

    it('外からの内容にプロンプト攻撃が検出されたら送らない', async () => {
      guardrail.inspect
        .mockResolvedValueOnce(noFindings())
        .mockResolvedValueOnce({
          ...noFindings(),
          content: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH' }],
        });
      await expect(
        service.createMessage(summaryParams, { untrusted: ['こんにちは'] }),
      ).rejects.toThrow('プロンプト攻撃');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('どちらで検出した個人情報も伏せて送る', async () => {
      guardrail.inspect
        .mockResolvedValueOnce({
          ...noFindings(),
          pii: [{ type: 'EMAIL', match: 'a@example.com' }],
        })
        .mockResolvedValueOnce({
          ...noFindings(),
          pii: [{ type: 'PHONE', match: '090-1234-5678' }],
        });
      mockCreate.mockResolvedValue(textResponse('要約'));
      await service.createMessage(
        {
          ...params,
          messages: [
            {
              role: 'user',
              content: '宛先 a@example.com\n会話: 電話は 090-1234-5678',
            },
          ],
        },
        { untrusted: ['電話は 090-1234-5678'] },
      );
      const [[sent]] = mockCreate.mock.calls as [
        [Anthropic.MessageCreateParamsNonStreaming],
      ];
      expect(sent.messages[0].content).toBe(
        '宛先 [メールアドレス]\n会話: 電話は [電話番号]',
      );
    });
  });
});

describe('withEthicsSystem', () => {
  it('system がない場合は AI倫理の指示だけにする', () => {
    expect(withEthicsSystem(params).system).toEqual([
      { type: 'text', text: ETHICS_SYSTEM_PROMPT },
    ]);
  });

  it('system がブロックの配列の場合は、先頭に足す（キャッシュの指定は残す）', () => {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: '指示', cache_control: { type: 'ephemeral' } },
    ];
    expect(withEthicsSystem({ ...params, system }).system).toEqual([
      { type: 'text', text: ETHICS_SYSTEM_PROMPT },
      ...system,
    ]);
  });
});
