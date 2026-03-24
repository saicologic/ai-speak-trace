import { Injectable, Logger } from '@nestjs/common';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsCreditInfo, ElevenLabsResponse } from './types/elevenlabs.types';

/**
 * APIタイムアウト（秒）
 * 長い音声でも処理できるよう十分なマージンを持たせる。
 * JobManagerServiceがバックグラウンドで実行するため、長時間ブロックしても問題ない。
 */
const API_TIMEOUT_SEC = 1800;

/** ファイルサイズ上限（3GB）: ElevenLabs APIのローカルアップロード上限 */
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024 * 1024;

/** ElevenLabs Scribe v2 APIとの通信を担当するサービス（公式SDK利用） */
@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);

  constructor() {}

  /** 現在のAPIキーを取得（設定画面からの変更を即時反映） */
  private getApiKey(): string {
    return process.env.ELEVENLABS_API_KEY || '';
  }

  /** APIキーの検証 */
  private validateApiKey(): void {
    const apiKey = this.getApiKey();
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error(
        'ELEVENLABS_API_KEY が設定されていません。backend/.env ファイルを確認してください。',
      );
    }
  }

  /** SDKクライアントを生成（APIキーは毎回最新を取得） */
  private createClient(): ElevenLabsClient {
    return new ElevenLabsClient({
      apiKey: this.getApiKey(),
    });
  }

  /** 音声データを文字起こしする */
  async transcribe(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<ElevenLabsResponse> {
    this.validateApiKey();

    const startTime = Date.now();
    const elapsedSec = () => Math.round((Date.now() - startTime) / 1000);
    const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(1);

    this.logger.log(`文字起こし開始: ${fileName} (${fileSizeMB} MB)`);

    // ファイルサイズ上限チェック
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `ファイルサイズが上限（3GB）を超えています（${fileSizeMB} MB）。音声ファイルを分割してください。`,
      );
    }

    const client = this.createClient();
    const blob = new Blob([new Uint8Array(fileBuffer)]);

    try {
      const response = await client.speechToText.convert(
        {
          file: blob,
          modelId: 'scribe_v2',
          languageCode: 'ja',
          diarize: true,
          numSpeakers: 2,
          timestampsGranularity: 'word',
          tagAudioEvents: true,
        },
        {
          timeoutInSeconds: API_TIMEOUT_SEC,
        },
      );

      const result = this.convertSdkResponse(response);

      this.logger.log(
        `文字起こし完了: ${fileName} (${result.words.length} 単語, 言語: ${result.language_code}, 所要時間: ${elapsedSec()}秒)`,
      );

      return result;
    } catch (error) {
      this.handleSdkError(error, fileName);
    }
  }

  /** SDK レスポンスをアプリ内部型に変換 */
  private convertSdkResponse(sdkResponse: any): ElevenLabsResponse {
    return {
      language_code: sdkResponse.languageCode ?? sdkResponse.language_code ?? 'ja',
      language_probability: sdkResponse.languageProbability ?? sdkResponse.language_probability ?? 0,
      text: sdkResponse.text ?? '',
      words: (sdkResponse.words ?? []).map((w: any) => ({
        text: w.text,
        start: w.start ?? 0,
        end: w.end ?? 0,
        type: w.type,
        speaker_id: w.speakerId ?? w.speaker_id ?? '',
        logprob: w.logprob ?? 0,
      })),
      transcription_id: sdkResponse.transcriptionId ?? sdkResponse.transcription_id ?? '',
    };
  }

  /** SDK エラーを解析してスローする */
  private handleSdkError(error: unknown, fileName: string): never {
    const statusCode = (error as any)?.statusCode ?? (error as any)?.status;
    const errorBody = (error as any)?.body ?? (error as any)?.message ?? '';
    const errorString = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody);

    this.logger.error(`ElevenLabs API エラー: status=${statusCode} ${errorString} (${fileName})`);

    // クォータ超過
    if (errorString.includes('quota_exceeded') || statusCode === 402) {
      let detail = '';
      try {
        const parsed = typeof errorBody === 'object' ? errorBody : JSON.parse(errorString);
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
      const quotaError = new Error(detail || '利用枠の上限に達しました。');
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    }

    // タイムアウト
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(
        `文字起こしがタイムアウトしました。音声ファイルが大きすぎる可能性があります。`,
      );
      timeoutError.name = 'TranscriptionTimeoutError';
      throw timeoutError;
    }

    // 認証エラー
    if (statusCode === 401) {
      throw new Error('ElevenLabs APIキーが無効です。');
    }

    // レート制限
    if (statusCode === 429) {
      throw new Error(
        'ElevenLabs APIのレート制限に達しました。しばらく待ってから再試行してください。',
      );
    }

    // その他のエラー
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`ElevenLabs API エラー: ${detail}`);
  }

  /** ElevenLabsのクレジット残量を確認する */
  async checkCredits(): Promise<ElevenLabsCreditInfo> {
    this.validateApiKey();

    // クレジット確認はSDKに対応メソッドがないためfetchで直接呼ぶ
    const response = await fetch(
      'https://api.elevenlabs.io/v1/user/subscription',
      { headers: { 'xi-api-key': this.getApiKey() } },
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
}
