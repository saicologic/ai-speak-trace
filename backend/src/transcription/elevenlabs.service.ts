import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import FormDataNode = require('form-data');
import {
  ElevenLabsCreditInfo,
  ElevenLabsResponse,
} from './types/elevenlabs.types';

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

    const form = new FormDataNode();
    form.append('file', fileBuffer, { filename: fileName });
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'ja');
    form.append('diarize', 'true');
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');

    this.logger.log(
      `ElevenLabs API リクエスト送信 (タイムアウト: ${TIMEOUT_MS / 60000}分)`,
    );

    let axiosResponse: axios.AxiosResponse;
    try {
      axiosResponse = await axios.post(this.apiUrl, form, {
        headers: { ...this.authHeaders, ...form.getHeaders() },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch (fetchError) {
      // タイムアウト
      if (axios.isAxiosError(fetchError) && fetchError.code === 'ECONNABORTED') {
        this.logger.error(
          `文字起こしタイムアウト: ${TIMEOUT_MS / 60000}分を超過 (${fileName})`,
        );
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
    }

    this.logger.log(
      `ElevenLabs API レスポンス受信: status=${axiosResponse.status} (${elapsedSec()}秒)`,
    );

    if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
      this.handleAxiosErrorResponse(axiosResponse.status, axiosResponse.data);
    }

    const result = axiosResponse.data as ElevenLabsResponse;
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

    const response = await axios.get<{
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    }>('https://api.elevenlabs.io/v1/user/subscription', {
      headers: this.authHeaders,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      this.logger.error(`ElevenLabs Subscription API エラー: ${response.status}`);
      if (response.status === 401) {
        throw new Error('ElevenLabs APIキーが無効です。');
      }
      throw new Error(`クレジット情報の取得に失敗しました (${response.status})`);
    }

    const data = response.data;
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
  private handleAxiosErrorResponse(status: number, data: unknown): never {
    const errorBody = typeof data === 'string' ? data : JSON.stringify(data);
    this.logger.error(`ElevenLabs API エラー: ${status} ${errorBody}`);

    // クォータ超過をチェック（401レスポンスにquota_exceededが含まれる場合）
    if (errorBody.includes('quota_exceeded')) {
      let detail = '';
      try {
        const parsed =
          typeof data === 'object' && data !== null
            ? (data as { detail?: { message?: string } })
            : (JSON.parse(errorBody) as { detail?: { message?: string } });
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

    switch (status) {
      case 401:
        throw new Error('ElevenLabs APIキーが無効です。');
      case 429:
        throw new Error(
          'ElevenLabs APIのレート制限に達しました。しばらく待ってから再試行してください。',
        );
      default:
        throw new Error(
          `ElevenLabs API エラー (${status}): ${errorBody}`,
        );
    }
  }

  /** 文字起こしステータスを取得（ジョブ確認用）
   *
   * ElevenLabs公式仕様:
   * - 200: トランスクリプトデータを正常に取得（完了）
   * - 401: 認証エラーまたはクォータ超過
   * - 404: トランスクリプトが存在しない（削除済みまたは無効なID）
   * - 422: バリデーションエラー
   */
  async getTranscriptionStatus(transcriptionId: string): Promise<{
    status: 'processing' | 'completed' | 'error';
    error_message?: string;
    data?: unknown;
  }> {
    const apiKey = this.getApiKey();
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error(
        'ELEVENLABS_API_KEY が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    const url = `${this.apiUrl}/transcripts/${transcriptionId}`;
    this.logger.log(`文字起こしステータス確認: ${transcriptionId}`);

    try {
      const response = await axios.get<unknown>(url, {
        headers: this.authHeaders,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        // 200: 完了（トランスクリプトデータを取得できた）
        this.logger.log(`文字起こし完了: ${transcriptionId}`);
        return { status: 'completed', data: response.data };
      }

      if (response.status === 404) {
        // 404: トランスクリプトが存在しない（削除済みまたは無効なID）
        this.logger.warn(
          `トランスクリプトが見つかりません: ${transcriptionId}`,
        );
        return {
          status: 'error',
          error_message:
            'トランスクリプトが見つかりません（削除済みまたは無効なID）',
        };
      }

      if (response.status === 401) {
        // 401: 認証エラーまたはクォータ超過
        const errorBody =
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
        this.logger.error(`認証エラー: ${errorBody}`);
        return {
          status: 'error',
          error_message: `認証エラー: ${errorBody}`,
        };
      }

      // その他のエラー
      this.logger.error(
        `文字起こしステータス確認エラー: ${response.status}`,
      );
      return {
        status: 'error',
        error_message: `ElevenLabs API エラー (${response.status})`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`文字起こしステータス確認失敗: ${errorMessage}`);
      return {
        status: 'error',
        error_message: errorMessage,
      };
    }
  }
}
