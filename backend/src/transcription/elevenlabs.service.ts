import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElevenLabsResponse } from './types/elevenlabs.types';

/** ElevenLabs Scribe v2 APIとの通信を担当するサービス */
@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.elevenlabs.io/v1/speech-to-text';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY', '');
  }

  /** 音声データを文字起こしする */
  async transcribe(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<ElevenLabsResponse> {
    if (!this.apiKey || this.apiKey === 'your_api_key_here') {
      throw new Error(
        'ELEVENLABS_API_KEY が設定されていません。backend/.env ファイルを確認してください。',
      );
    }

    this.logger.log(`文字起こし開始: ${fileName}`);

    const blob = new Blob([new Uint8Array(fileBuffer)]);

    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'ja');
    form.append('diarize', 'true');
    form.append('num_speakers', '2');
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `ElevenLabs API エラー: ${response.status} ${errorBody}`,
      );

      // クォータ超過をチェック（401レスポンスにquota_exceededが含まれる場合）
      if (errorBody.includes('quota_exceeded')) {
        // APIレスポンスからクレジット情報を抽出
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

    const result = (await response.json()) as ElevenLabsResponse;
    this.logger.log(
      `文字起こし完了: ${fileName} (${result.words.length} 単語)`,
    );

    return result;
  }
}
