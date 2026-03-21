import { Injectable, Logger } from '@nestjs/common';
import { ElevenLabsCreditInfo, ElevenLabsResponse } from './types/elevenlabs.types';

/** 全体のタイムアウト（ミリ秒）: 30分
 * ElevenLabsはリアルタイムの20〜50倍速で処理するため、
 * 10時間の音声でも最大30分程度で完了する */
const TIMEOUT_MS = 30 * 60 * 1000;

/** ElevenLabs Scribe v2 APIとの通信を担当するサービス */
@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);
  private readonly apiUrl = 'https://api.elevenlabs.io/v1/speech-to-text';

  constructor() {}

  /** 現在のAPIキーを取得（設定画面からの変更を即時反映） */
  private getApiKey(): string {
    return process.env.ELEVENLABS_API_KEY || '';
  }

  /** 認証ヘッダーを生成 */
  private get authHeaders(): Record<string, string> {
    return { 'xi-api-key': this.getApiKey() };
  }

  /** 音声データを文字起こしする（同期モード + タイムアウト制御） */
  async transcribe(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<ElevenLabsResponse> {
    if (!this.getApiKey() || this.getApiKey() === 'your_api_key_here') {
      throw new Error(
        'ELEVENLABS_API_KEY が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    const startTime = Date.now();
    const elapsedSec = () => Math.round((Date.now() - startTime) / 1000);

    const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(1);
    this.logger.log(`文字起こし開始: ${fileName} (${fileSizeMB} MB)`);

    const blob = new Blob([new Uint8Array(fileBuffer)]);
    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'ja');
    form.append('diarize', 'true');
    form.append('num_speakers', '2');
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');

    // 大ファイル対応: AbortControllerでタイムアウト制御
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    this.logger.log(`ElevenLabs API リクエスト送信 (タイムアウト: ${TIMEOUT_MS / 60000}分)`);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.authHeaders,
        body: form,
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      // AbortErrorはタイムアウトとして処理
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        this.logger.error(`文字起こしタイムアウト: ${TIMEOUT_MS / 60000}分を超過 (${fileName})`);
        const error = new Error(
          `文字起こしがタイムアウトしました（${TIMEOUT_MS / 60000}分経過）。音声ファイルが大きすぎる可能性があります。`,
        );
        error.name = 'TranscriptionTimeoutError';
        throw error;
      }
      const detail =
        fetchError instanceof Error
          ? `${fetchError.name}: ${fetchError.message}`
          : String(fetchError);
      this.logger.error(`ElevenLabs API 通信エラー: ${detail}`);
      throw new Error(`ElevenLabs APIへの接続に失敗しました: ${detail}`);
    } finally {
      clearTimeout(timeoutId);
    }

    this.logger.log(`ElevenLabs API レスポンス受信: status=${response.status} (${elapsedSec()}秒)`);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const result = (await response.json()) as ElevenLabsResponse;
    this.logger.log(
      `文字起こし完了: ${fileName} (${result.words.length} 単語, 言語: ${result.language_code}, 所要時間: ${elapsedSec()}秒)`,
    );

    return result;
  }

  /** ElevenLabsのクレジット残量を確認する */
  async checkCredits(): Promise<ElevenLabsCreditInfo> {
    const apiKey = this.getApiKey();
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error(
        'ELEVENLABS_API_KEY が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    const response = await fetch(
      'https://api.elevenlabs.io/v1/user/subscription',
      { headers: this.authHeaders },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `ElevenLabs Subscription API エラー: ${response.status} ${errorBody}`,
      );
      if (response.status === 401) {
        throw new Error('ElevenLabs APIキーが無効です。');
      }
      throw new Error(
        `クレジット情報の取得に失敗しました (${response.status})`,
      );
    }

    const data = await response.json();
    const characterCount: number = data.character_count ?? 0;
    const characterLimit: number = data.character_limit ?? 0;
    const nextResetUnix: number = data.next_character_count_reset_unix ?? 0;

    return {
      characterCount,
      characterLimit,
      remainingCredits: characterLimit - characterCount,
      nextResetDate: nextResetUnix
        ? new Date(nextResetUnix * 1000).toISOString()
        : '',
    };
  }

  /** エラーレスポンスを解析してスローする */
  private async handleErrorResponse(response: Response): Promise<never> {
    const errorBody = await response.text();
    this.logger.error(
      `ElevenLabs API エラー: ${response.status} ${errorBody}`,
    );

    // クォータ超過をチェック（401レスポンスにquota_exceededが含まれる場合）
    if (errorBody.includes('quota_exceeded')) {
      let detail = '';
      try {
        const parsed = JSON.parse(errorBody);
        const msg: string = parsed?.detail?.message ?? '';
        const quota = msg.match(/quota of (\d+)/)?.[1];
        const remaining = msg.match(/have (\d+) credits remaining/)?.[1];
        const required = msg.match(/(\d+) credits are required/)?.[1];
        if (quota && remaining && required) {
          detail = `プラン上限\u3000\u3000\u3000\u3000\u3000: ${Number(quota).toLocaleString()}\n残りクレジット\u3000\u3000\u3000: ${Number(remaining).toLocaleString()}\n今回必要なクレジット: ${Number(required).toLocaleString()}`;
        }
      } catch {
        // パース失敗時は詳細なしで続行
      }
      const error = new Error(detail || '利用枠の上限に達しました。');
      error.name = 'QuotaExceededError';
      throw error;
    }

    switch (response.status) {
      case 401:
        throw new Error('ElevenLabs APIキーが無効です。');
      case 429:
        throw new Error(
          'ElevenLabs APIのレート制限に達しました。しばらく待ってから再試行してください。',
        );
      default:
        throw new Error(
          `ElevenLabs API エラー (${response.status}): ${errorBody}`,
        );
    }
  }
}
