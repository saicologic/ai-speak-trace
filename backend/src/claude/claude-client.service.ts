import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { GuardrailService } from '../privacy/guardrail.service';
import { PiiFinding } from '../privacy/privacy.types';
import {
  collectImmutableRequestTexts,
  collectImmutableResponseTexts,
  collectRequestText,
  collectResponseText,
  findBlockingContent,
  findUnmaskable,
  mapRequestTexts,
  mapResponseTexts,
  masker,
  toAutoMaskFindings,
} from './claude-guard.utils';

/**
 * Claude API の呼び出しを担うサービス
 *
 * Claude には必ず createMessage から送る。送る前と受け取った後に Amazon Bedrock Guardrails でチェックする。
 * - Guardrail ID が未設定の場合は送らない
 * - 送る内容にプロンプト攻撃が検出された場合は送らない
 * - 連絡先などの個人情報は伏せ字（[電話番号] など）に置き換えて送る。応答も同様に置き換える
 */
@Injectable()
export class ClaudeClientService {
  private readonly logger = new Logger(ClaudeClientService.name);

  constructor(private readonly guardrail: GuardrailService) {}

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

  /** Guardrails のチェックを通してから Claude にメッセージを送る */
  async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    if (!this.guardrail.isConfigured()) {
      throw new BadRequestException(
        'Claude に送る前のチェックのため、設定画面で Guardrail ID を設定してください',
      );
    }

    const inputText = collectRequestText(params);
    const inputFindings = await this.guardrail.inspect(inputText, 'INPUT', {
      requireFullCoverage: true,
    });
    const blocked = findBlockingContent(inputFindings);
    if (blocked.length > 0) {
      this.logger.warn(`Guardrails が送信を止めました: ${blocked.join(', ')}`);
      throw new BadRequestException(
        `送る内容に指示の書き換え（プロンプト攻撃）の疑いがあるため、Claude に送りませんでした（${blocked.join(', ')}）`,
      );
    }
    const inputMasks = toAutoMaskFindings(inputFindings, inputText);
    const unmaskableInput = findUnmaskable(
      collectImmutableRequestTexts(params),
      inputMasks,
    );
    if (unmaskableInput.length > 0) {
      throw new BadRequestException(
        `送る内容の、伏せられない部分（思考・検索語・検索結果の題名）に個人情報（${labels(unmaskableInput)}）が含まれるため、Claude に送りませんでした`,
      );
    }
    if (inputMasks.length > 0) {
      this.logger.log(`送る内容の個人情報を伏せます: ${inputMasks.length}件`);
    }
    const response = await this.getClient().messages.create(
      mapRequestTexts(params, masker(inputMasks)),
    );

    const outputText = collectResponseText(response);
    const outputFindings = await this.guardrail.inspect(outputText, 'OUTPUT', {
      requireFullCoverage: true,
    });
    const outputMasks = toAutoMaskFindings(outputFindings, outputText);
    const unmaskableOutput = findUnmaskable(
      collectImmutableResponseTexts(response),
      outputMasks,
    );
    if (unmaskableOutput.length > 0) {
      throw new BadRequestException(
        `Claude の応答の、伏せられない部分（思考・検索語・検索結果の題名）に個人情報（${labels(unmaskableOutput)}）が含まれるため、応答を使いませんでした`,
      );
    }
    if (outputMasks.length > 0) {
      this.logger.log(`応答の個人情報を伏せます: ${outputMasks.length}件`);
    }
    return mapResponseTexts(response, masker(outputMasks));
  }

  /** Anthropicクライアントを取得（設定画面からの変更を即時反映）。Guardrails を通さないため外部に公開しない */
  private getClient(): Anthropic {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: this.axiosFetch.bind(this),
    });
  }
}

/** 個人情報の種類の表示名（重複なし） */
function labels(findings: PiiFinding[]): string {
  return [...new Set(findings.map((f) => f.label))].join('、');
}
