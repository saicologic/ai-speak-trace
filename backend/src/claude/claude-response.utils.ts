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

/**
 * 応答が最後まで生成されなかった場合は例外を投げる
 * - refusal: Claudeが応答を拒否した（content は空または途中まで）
 * - max_tokens: 出力が上限に達して途中で切れた。思考（thinking）のトークンも上限に含まれるため、
 *   本文が空や途中のまま返ることがあり、そのまま使うと原因のわからないパースエラーになる
 */
export function assertCompleteResponse(response: Anthropic.Message): void {
  if (response.stop_reason === 'refusal') {
    throw new Error('Claudeがこのリクエストへの応答を拒否しました');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'Claudeの出力が上限に達したため、結果が途中で切れました。入力（会話）が長すぎる可能性があります。',
    );
  }
}
