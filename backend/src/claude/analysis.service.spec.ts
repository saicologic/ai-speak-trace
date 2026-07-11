import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { ClaudeClientService } from './claude-client.service';
import { GuardrailService } from './guardrail.service';
import { FaithfulnessCheckerService } from './faithfulness-checker.service';

const mockMessagesCreate = jest.fn();
const mockClaudeClientService = {
  getClient: () => ({ messages: { create: mockMessagesCreate } }),
};

const mockGuardrailService = {
  groundingSystemPrompt: 'グラウンディングシステムプロンプト',
  buildConversationMessages: jest.fn().mockReturnValue([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_test', name: 'load_conversation', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_test', content: [{ type: 'text', text: '{}' }] }] },
  ]),
};

const mockFaithfulnessChecker = {
  validateOrFallback: jest.fn().mockImplementation((_q, answer) => Promise.resolve(answer)),
};

function makeTextResponse(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}

function makeSearchResponse(text: string, urls: string[] = []) {
  return {
    content: [
      {
        type: 'web_search_tool_result',
        tool_use_id: 'search_01',
        content: urls.map((url) => ({ type: 'web_search_result', url, title: url })),
      },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
  };
}

describe('AnalysisService', () => {
  let service: AnalysisService;

  beforeEach(async () => {
    mockMessagesCreate.mockReset();
    (mockGuardrailService.buildConversationMessages as jest.Mock).mockClear();
    (mockFaithfulnessChecker.validateOrFallback as jest.Mock).mockImplementation(
      (_q, answer) => Promise.resolve(answer),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: ClaudeClientService, useValue: mockClaudeClientService },
        { provide: GuardrailService, useValue: mockGuardrailService },
        { provide: FaithfulnessCheckerService, useValue: mockFaithfulnessChecker },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  describe('buildGenerateQuestionsPrompt', () => {
    it('キーワードと話者名を含むプロンプトを返す', () => {
      const prompt = service.buildGenerateQuestionsPrompt(['LLM', '富岳'], 'Aさん');

      expect(prompt).toContain('Aさん');
      expect(prompt).toContain('LLM');
      expect(prompt).toContain('富岳');
    });
  });

  describe('buildAnalysisPrompt', () => {
    it('ガードレール指示を含むプロンプトを返す', () => {
      const prompt = service.buildAnalysisPrompt('質問文', ['LLM'], 'Aさん');

      expect(prompt).toContain('ガードレール');
      expect(prompt).toContain('確認できませんでした');
    });

    it('web_fetchに言及している', () => {
      const prompt = service.buildAnalysisPrompt('質問文', ['LLM'], 'Aさん');

      expect(prompt).toContain('Webフェッチ');
    });
  });

  describe('generateQuestions', () => {
    it('Claudeの返したテキストを行分割して質問リストを返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeTextResponse('【LLM】LLMとは何ですか\n【富岳】富岳の性能は'),
      );

      const result = await service.generateQuestions(['LLM', '富岳'], 'Aさん');

      expect(result).toEqual(['【LLM】LLMとは何ですか', '【富岳】富岳の性能は']);
    });

    it('claude-sonnet-4-6 を使用する', async () => {
      mockMessagesCreate.mockResolvedValue(makeTextResponse('質問1'));

      await service.generateQuestions(['LLM'], 'Aさん');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });

    it('グラウンディングシステムプロンプトを渡す', async () => {
      mockMessagesCreate.mockResolvedValue(makeTextResponse('質問1'));

      await service.generateQuestions(['LLM'], 'Aさん');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'グラウンディングシステムプロンプト' }),
      );
    });
  });

  describe('analyze', () => {
    it('各質問に対してanalyzeQuestionを実行し結果リストを返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeSearchResponse('回答テキスト', ['https://example.com']),
      );

      const results = await service.analyze(['質問1', '質問2'], ['LLM'], 'Aさん');

      expect(results).toHaveLength(2);
      expect(results[0].question).toBe('質問1');
      expect(results[0].answer).toBe('回答テキスト');
    });

    it('1つの質問でAPIエラーが起きても他の質問の結果を返す', async () => {
      mockMessagesCreate
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValue(makeSearchResponse('回答2'));

      const results = await service.analyze(['質問1', '質問2'], ['LLM'], 'Aさん');

      expect(results).toHaveLength(2);
      expect(results[0].answer).toContain('エラー');
      expect(results[1].answer).toBe('回答2');
    });

    it('web_search_tool_resultブロックからsourcesを収集する', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeSearchResponse('回答', ['https://source1.com', 'https://source2.com']),
      );

      const results = await service.analyze(['質問1'], ['LLM'], 'Aさん');

      expect(results[0].sources).toHaveLength(2);
      expect(results[0].sources[0].url).toBe('https://source1.com');
    });

    it('FaithfulnessCheckerを通じて回答を検証する', async () => {
      mockMessagesCreate.mockResolvedValue(makeSearchResponse('回答'));

      await service.analyze(['質問1'], ['LLM'], 'Aさん');

      expect(mockFaithfulnessChecker.validateOrFallback).toHaveBeenCalledWith(
        '質問1',
        '回答',
        expect.any(Array),
      );
    });

    it('FaithfulnessCheckerがフォールバックを返したときその値を使う', async () => {
      mockMessagesCreate.mockResolvedValue(makeSearchResponse('ハルシネーションを含む回答'));
      (mockFaithfulnessChecker.validateOrFallback as jest.Mock).mockResolvedValue(
        '提供された情報では十分な回答ができませんでした。',
      );

      const results = await service.analyze(['質問1'], ['LLM'], 'Aさん');

      expect(results[0].answer).toContain('提供された情報では');
    });
  });

  describe('analyzeContext', () => {
    const utterances = [
      { speakerName: 'Aさん', text: 'こんにちは' },
      { speakerName: 'Bさん', text: 'よろしく' },
    ];

    it('JSON配列をパースして返す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeTextResponse('[{"index":0,"intent":"挨拶","topic":"あいさつ"}]'),
      );

      const result = await service.analyzeContext(utterances, [0]);

      expect(result).toHaveLength(1);
      expect(result[0].intent).toBe('挨拶');
    });

    it('会話データをGuardrailServiceのtool_result形式で渡す', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeTextResponse('[{"index":0,"intent":"挨拶","topic":"あいさつ"}]'),
      );

      await service.analyzeContext(utterances, [0]);

      expect(mockGuardrailService.buildConversationMessages).toHaveBeenCalledWith(utterances);
    });

    it('要求していないインデックスを除外する', async () => {
      mockMessagesCreate.mockResolvedValue(
        makeTextResponse(
          '[{"index":0,"intent":"挨拶","topic":"あいさつ"},{"index":99,"intent":"その他","topic":"不正"}]',
        ),
      );

      const result = await service.analyzeContext(utterances, [0]);

      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(0);
    });

    it('JSONが返らないときエラーをスロー', async () => {
      mockMessagesCreate.mockResolvedValue(makeTextResponse('JSONなし'));

      await expect(service.analyzeContext(utterances, [0])).rejects.toThrow(
        '文脈分析結果のパースに失敗しました',
      );
    });
  });

  describe('analyzeSearchResults', () => {
    it('web_searchツール付きでClaudeを呼び出す', async () => {
      mockMessagesCreate.mockResolvedValue(makeTextResponse('レポート'));

      await service.analyzeSearchResults(['LLM'], [
        { sourceType: 'conversation', sourceName: '会話', text: '内容' },
      ]);

      const call = mockMessagesCreate.mock.calls[0][0];
      const hasWebSearch = call.tools?.some((t: any) => t.name === 'web_search');
      expect(hasWebSearch).toBe(true);
    });

    it('ガードレールのソース番号付与指示を含むプロンプトを渡す', async () => {
      mockMessagesCreate.mockResolvedValue(makeTextResponse('レポート'));

      await service.analyzeSearchResults(['LLM'], [
        { sourceType: 'pdf', sourceName: '論文', text: '内容' },
      ]);

      const call = mockMessagesCreate.mock.calls[0][0];
      const prompt = call.messages[0].content as string;
      expect(prompt).toContain('ソース番号');
    });
  });
});
