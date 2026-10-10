import type Anthropic from '@anthropic-ai/sdk';
import { assertNotRefused, extractText } from './claude-response.utils';

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

describe('assertNotRefused', () => {
  it('stop_reasonがrefusalなら例外を投げる', () => {
    const response = { stop_reason: 'refusal', content: [] };

    expect(() =>
      assertNotRefused(response as unknown as Anthropic.Message),
    ).toThrow('拒否');
  });

  it('それ以外は何もしない', () => {
    const response = { stop_reason: 'end_turn', content: [] };

    expect(() =>
      assertNotRefused(response as unknown as Anthropic.Message),
    ).not.toThrow();
  });
});
