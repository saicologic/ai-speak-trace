/** 話者情報 */
export interface Speaker {
  id: string;
  name: string;
  color: string;
}

/** 単語データ */
export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  type: 'word' | 'spacing' | 'audio_event';
  speakerId: string;
}

/** 発話セグメント */
export interface Utterance {
  speakerId: string;
  speakerName: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
}

/** 文字起こし結果 */
export interface Transcription {
  id: string;
  audioFileName: string;
  createdAt: string;
  languageCode: string;
  fullText: string;
  speakers: Speaker[];
  words: TranscriptionWord[];
  utterances: Utterance[];
}

/** 音声ファイル情報 */
export interface AudioFileInfo {
  fileName: string;
  sizeBytes: number;
  lastModified: string;
}
