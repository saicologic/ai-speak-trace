import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

/** Anthropicクライアントの生成を担うベースサービス */
@Injectable()
export class ClaudeClientService {
  /**
   * pkg --jitless 環境では globalThis.fetch が壊れるため、
   * axios を使った fetch 互換関数を Anthropic クライアントに渡す
   */
  private async axiosFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : undefined) ?? 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(h)) {
        h.forEach(([k, v]) => { headers[k] = v; });
      } else {
        Object.assign(headers, h);
      }
    }

    const response = await axios({
      url,
      method,
      headers,
      data: init?.body ?? undefined,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      decompress: true,
    });

    const bodyBuffer = Buffer.from(response.data as ArrayBuffer);
    const responseHeaders = new Headers();
    Object.entries(response.headers).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        responseHeaders.set(k, String(v));
      }
    });

    return new Response(bodyBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  /** Anthropicクライアントを取得（設定画面からの変更を即時反映） */
  getClient(): Anthropic {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: this.axiosFetch.bind(this),
    });
  }
}
