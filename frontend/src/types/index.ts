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

/** 文字起こしサマリー（一覧表示用） */
export interface TranscriptionSummary {
  id: string;
  audioFileName: string;
  createdAt: string;
}

/** キーワード（専門用語） */
export interface Keyword {
  text: string;
  count: number;
}

/** 分析結果（1つの質問に対する回答） */
export interface AnalysisResult {
  question: string;
  answer: string;
  sources: { title: string; url: string }[];
}

/** 会話分析レスポンス */
export interface InterviewAnalysis {
  id: string;
  transcriptionId: string;
  speakerId: string;
  speakerName: string;
  keywords: string[];
  results: AnalysisResult[];
  createdAt: string;
}

/** 発言の文脈分析結果（1つの発話） */
export interface UtteranceContextResult {
  utteranceIndex: number;
  speakerId: string;
  speakerName: string;
  text: string;
  previousUtterance: {
    speakerName: string;
    text: string;
  } | null;
  intent: string;
  topic: string;
}

/** 発言の文脈分析レスポンス */
export interface ContextAnalysisResponse {
  transcriptionId: string;
  results: UtteranceContextResult[];
}
