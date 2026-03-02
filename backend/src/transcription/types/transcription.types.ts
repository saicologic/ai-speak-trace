/** 話者情報 */
export interface Speaker {
  /** 話者ID（例: "speaker_0"） */
  id: string;
  /** 話者名（デフォルト: "Aさん", "Bさん"） */
  name: string;
  /** 表示色 */
  color: string;
}

/** 単語データ（フロントエンド表示用） */
export interface TranscriptionWord {
  /** テキスト */
  text: string;
  /** 開始時間（秒） */
  start: number;
  /** 終了時間（秒） */
  end: number;
  /** 単語の種類 */
  type: 'word' | 'spacing' | 'audio_event';
  /** 話者ID */
  speakerId: string;
}

/** 発話セグメント（同一話者の連続発話をグループ化） */
export interface Utterance {
  /** 話者ID */
  speakerId: string;
  /** 話者名 */
  speakerName: string;
  /** 開始時間（秒） */
  start: number;
  /** 終了時間（秒） */
  end: number;
  /** 発話テキスト */
  text: string;
  /** 含まれる単語データ */
  words: TranscriptionWord[];
}

/** 文字起こし結果全体 */
export interface Transcription {
  /** 一意のID */
  id: string;
  /** 元の音声ファイル名 */
  audioFileName: string;
  /** 作成日時（ISO 8601） */
  createdAt: string;
  /** 検出された言語コード */
  languageCode: string;
  /** 文字起こし全文 */
  fullText: string;
  /** 話者情報 */
  speakers: Speaker[];
  /** 単語レベルのデータ */
  words: TranscriptionWord[];
  /** 発話セグメント */
  utterances: Utterance[];
}

/** 音声ファイル情報 */
export interface AudioFileInfo {
  /** ファイル名 */
  fileName: string;
  /** ファイルサイズ（バイト） */
  sizeBytes: number;
  /** 最終更新日時 */
  lastModified: string;
}
