import type Anthropic from '@anthropic-ai/sdk';

/**
 * 応答のテキストブロックを連結して返す
 * 思考（thinking）が有効なモデルでは先頭が thinking ブロックになるため、content[0] を決め打ちしない
 */
export function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** Claudeが応答を拒否した場合は例外を投げる（拒否時は content が空または途中までになる） */
export function assertNotRefused(response: Anthropic.Message): void {
  if (response.stop_reason === 'refusal') {
    throw new Error('Claudeがこのリクエストへの応答を拒否しました');
  }
}
