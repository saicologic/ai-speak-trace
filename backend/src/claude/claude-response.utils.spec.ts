import type Anthropic from '@anthropic-ai/sdk';
import { assertCompleteResponse, extractText } from './claude-response.utils';

describe('extractText', () => {
  it('thinkingブロックを飛ばしてテキストブロックを連結する', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '前半', citations: null },
      { type: 'text', text: '後半', citations: null },
    ] as Anthropic.ContentBlock[];

    expect(extractText(content)).toBe('前半後半');
  });

  it('テキストブロックがなければ空文字を返す', () => {
    expect(extractText([])).toBe('');
  });
});

describe('assertCompleteResponse', () => {
  it('stop_reasonがrefusalなら例外を投げる', () => {
    const response = { stop_reason: 'refusal', content: [] };

    expect(() =>
      assertCompleteResponse(response as unknown as Anthropic.Message),
    ).toThrow('拒否');
  });

  it('stop_reasonがmax_tokensなら途中で切れた旨の例外を投げる', () => {
    const response = { stop_reason: 'max_tokens', content: [] };

    expect(() =>
      assertCompleteResponse(response as unknown as Anthropic.Message),
    ).toThrow('上限');
  });

  it('それ以外は何もしない', () => {
    const response = { stop_reason: 'end_turn', content: [] };

    expect(() =>
      assertCompleteResponse(response as unknown as Anthropic.Message),
    ).not.toThrow();
  });
});
