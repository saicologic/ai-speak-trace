/** ElevenLabs Scribe v2 APIの単語レベルデータ */
export interface ElevenLabsWord {
  /** 文字起こしされたテキスト */
  text: string;
  /** 開始時間（秒） */
  start: number;
  /** 終了時間（秒） */
  end: number;
  /** 単語の種類 */
  type: 'word' | 'spacing' | 'audio_event';
  /** 話者ID（例: "speaker_0", "speaker_1"） */
  speaker_id: string;
  /** 信頼度スコア（対数確率） */
  logprob: number;
}

/** ElevenLabs Scribe v2 APIレスポンス */
export interface ElevenLabsResponse {
  /** 検出された言語コード */
  language_code: string;
  /** 言語検出の信頼度 */
  language_probability: number;
  /** 文字起こし全文 */
  text: string;
  /** 単語レベルのデータ配列 */
  words: ElevenLabsWord[];
  /** トランスクリプションID */
  transcription_id: string;
}

/** ElevenLabs サブスクリプション情報（クレジット確認用） */
export interface ElevenLabsCreditInfo {
  /** 使用済みクレジット数 */
  characterCount: number;
  /** クレジット上限 */
  characterLimit: number;
  /** 残りクレジット数 */
  remainingCredits: number;
  /** クレジットリセット日時（ISO文字列） */
  nextResetDate: string;
}
