import type Anthropic from '@anthropic-ai/sdk';
import {
  collectRequestText,
  collectRequestTextByTrust,
  collectResponseText,
  findBlockingContent,
  findBlockingOutputContent,
  findOutputWarnings,
  mapRequestTexts,
  mapResponseTexts,
} from './claude-guard.utils';

/** pause_turn の再開で送り返す assistant の発言 */
const assistantTurn: Anthropic.MessageParam = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: '考え', signature: 'sig' },
    {
      type: 'server_tool_use',
      id: 's1',
      name: 'web_search',
      input: { query: '検索語' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 's1',
      content: [
        {
          type: 'web_search_result',
          title: '記事の題名',
          url: 'https://example.com',
          encrypted_content: 'enc',
        },
      ],
    },
    {
      type: 'text',
      text: '本文',
      citations: [
        {
          type: 'web_search_result_location',
          cited_text: '引用本文',
          encrypted_index: 'idx',
          title: '記事の題名',
          url: 'https://example.com',
        },
      ],
    },
  ],
};

describe('collectRequestText', () => {
  it('system・user のテキスト・文書・ツールの結果と、assistant の発言を集める', () => {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      system: 'システム',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'text', media_type: 'text/plain', data: '本文' },
              title: '題名',
              context: 'https://example.com',
            },
            {
              type: 'document',
              source: {
                type: 'content',
                content: [{ type: 'text', text: 'Aさん: 発言' }],
              },
            },
            { type: 'text', text: '指示' },
          ],
        },
        { role: 'assistant', content: 'Claude の応答' },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'ツールの結果' },
          ],
        },
      ],
    };
    expect(collectRequestText(params).split('\n')).toEqual([
      'システム',
      '題名',
      'https://example.com',
      '本文',
      'Aさん: 発言',
      '指示',
      'Claude の応答',
      'ツールの結果',
    ]);
  });

  it('PDF の文書はチェックできないため例外を投げる', () => {
    expect(() =>
      collectRequestText({
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: '',
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('チェックできない内容');
  });
});

describe('collectRequestText（assistant の発言）', () => {
  it('pause_turn で送り返す思考・検索語・検索結果の題名・本文・引用本文も集める', () => {
    expect(
      collectRequestText({
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: '質問' }, assistantTurn],
      }).split('\n'),
    ).toEqual([
      '質問',
      '考え',
      '{"query":"検索語"}',
      '記事の題名',
      '本文',
      '引用本文',
    ]);
  });

  it('アプリが書いた tool_use は、入力をチェックの対象に含める', () => {
    const text = collectRequestText({
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'x', input: { q: '入力' } },
          ],
        },
      ],
    });
    expect(text).toContain('入力');
  });

  it('チェックできない assistant の内容があれば例外を投げる', () => {
    expect(() =>
      collectRequestText({
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: '' },
              } as unknown as Anthropic.ContentBlockParam,
            ],
          },
        ],
      }),
    ).toThrow('チェックできない内容');
  });
});

describe('mapRequestTexts', () => {
  it('assistant の発言は本文と引用本文だけを置き換え、思考と検索結果は変えない', () => {
    const mapped = mapRequestTexts(
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        messages: [assistantTurn],
      },
      (t) => `[${t}]`,
    );
    const content = mapped.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual((assistantTurn.content as unknown[])[0]);
    expect(content[2]).toEqual((assistantTurn.content as unknown[])[2]);
    expect(content[3]).toMatchObject({
      text: '[本文]',
      citations: [{ cited_text: '[引用本文]' }],
    });
  });

  it('元のリクエストを変更せずに、置き換えた複製を返す', () => {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'abc' }] }],
    };
    const mapped = mapRequestTexts(params, (t) => t.toUpperCase());
    expect(mapped.messages[0].content).toEqual([{ type: 'text', text: 'ABC' }]);
    expect(params.messages[0].content).toEqual([{ type: 'text', text: 'abc' }]);
  });
});

describe('findBlockingContent', () => {
  it('プロンプト攻撃だけを送信を止める検出として返す', () => {
    expect(
      findBlockingContent({
        pii: [],
        words: [],
        content: [
          { type: 'INSULTS', confidence: 'HIGH' },
          { type: 'PROMPT_ATTACK', confidence: 'MEDIUM' },
          { type: 'PROMPT_ATTACK', confidence: 'HIGH' },
        ],
      }),
    ).toEqual(['PROMPT_ATTACK']);
  });
});

describe('mapResponseTexts / collectResponseText', () => {
  const message = {
    content: [
      {
        type: 'text',
        text: '本文',
        citations: [
          {
            type: 'web_search_result_location',
            cited_text: '引用本文',
            encrypted_index: 'idx',
            title: 't',
            url: 'https://example.com',
          },
        ],
      },
      { type: 'text', text: '引用なし', citations: null },
    ],
  } as unknown as Anthropic.Message;

  it('本文と引用本文を集める', () => {
    expect(collectResponseText(message).split('\n')).toEqual([
      '本文',
      '引用本文',
      '引用なし',
    ]);
  });

  it('本文と引用本文を置き換え、引用がないブロックはそのまま', () => {
    const mapped = mapResponseTexts(message, (t) => `[${t}]`);
    expect(mapped.content[0]).toMatchObject({
      text: '[本文]',
      citations: [{ cited_text: '[引用本文]' }],
    });
    expect(mapped.content[1]).toMatchObject({
      text: '[引用なし]',
      citations: null,
    });
  });
});

describe('collectRequestTextByTrust', () => {
  const base = { model: 'claude-sonnet-5-5', max_tokens: 100 };

  it('system と user のテキストはアプリの指示、文書と assistant の発言は外からの内容にする', () => {
    const result = collectRequestTextByTrust(
      {
        ...base,
        system: 'システム',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: '会話' },
              },
              { type: 'text', text: '指示' },
            ],
          },
          assistantTurn,
        ],
      },
      [],
    );
    expect(result.trusted).toBe('システム\n指示');
    expect(result.untrusted).toBe(
      '会話\n考え\n{"query":"検索語"}\n記事の題名\n本文\n引用本文',
    );
  });

  it('指示に埋め込んだ外からの内容は、外からの内容に移す（長いものから）', () => {
    const result = collectRequestTextByTrust(
      {
        ...base,
        messages: [
          { role: 'user', content: '要約して:\nAさん: こんにちは\n以上' },
        ],
      },
      ['こんにちは', 'Aさん: こんにちは', ''],
    );
    expect(result.trusted).toBe('要約して:\n\n\n以上');
    expect(result.untrusted).toBe('Aさん: こんにちは');
  });
});

describe('findBlockingOutputContent / findOutputWarnings', () => {
  const findings = {
    pii: [],
    words: [],
    content: [
      { type: 'INSULTS', confidence: 'HIGH' },
      { type: 'INSULTS', confidence: 'MEDIUM' },
      { type: 'VIOLENCE', confidence: 'MEDIUM' },
      { type: 'MISCONDUCT', confidence: 'LOW' },
      { type: 'PROMPT_ATTACK', confidence: 'HIGH' },
    ],
  };

  it('信頼度 HIGH の不適切な表現だけを、応答を使わない検出にする（プロンプト攻撃は除く）', () => {
    expect(findBlockingOutputContent(findings)).toEqual([
      { type: 'INSULTS', confidence: 'HIGH' },
    ]);
  });

  it('信頼度 MEDIUM 以上を、種類ごとに信頼度の高い方で1件の警告にする', () => {
    expect(findOutputWarnings(findings)).toEqual([
      { type: 'INSULTS', confidence: 'HIGH' },
      { type: 'VIOLENCE', confidence: 'MEDIUM' },
    ]);
  });
});
