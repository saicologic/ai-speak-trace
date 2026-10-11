import type Anthropic from '@anthropic-ai/sdk';
import {
  collectRequestText,
  findBlockingContent,
  mapRequestTexts,
} from './claude-guard.utils';

describe('collectRequestText', () => {
  it('system・user のテキスト・文書・ツールの結果を集め、assistant の発言は集めない', () => {
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

describe('mapRequestTexts', () => {
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
