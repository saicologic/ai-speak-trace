import {
  Speaker,
  TranscriptionWord,
  Utterance,
} from './types/transcription.types';
import { ElevenLabsWord } from './types/elevenlabs.types';

/**
 * インデックスからアルファベット順の話者名を生成する
 * 0〜25: Aさん〜Zさん、26〜: AAさん、ABさん...
 * ElevenLabs Scribe v2の話者分離上限は32人
 * @see https://elevenlabs.io/docs/capabilities/speech-to-text
 */
export function generateSpeakerName(index: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < 26) {
    return `${chars[index]}さん`;
  }
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return `${chars[first]}${chars[second]}さん`;
}

/** 話者の表示色（最大32人分、ElevenLabs Scribe v2の話者分離上限に対応） */
export const SPEAKER_COLORS = [
  '#3B82F6', // 青
  '#EF4444', // 赤
  '#10B981', // 緑
  '#F59E0B', // 黄
  '#8B5CF6', // 紫
  '#EC4899', // ピンク
  '#06B6D4', // シアン
  '#F97316', // オレンジ
];

/** フレーズ区切りとなる句読点パターン */
export const PHRASE_BREAK_CHARS = /[。、！？!?,.\s]/;

/** フレーズ区切りとなる時間間隔（秒） */
export const PHRASE_GAP_THRESHOLD = 0.5;

/** ElevenLabsの単語データをアプリ内部型に変換 */
export function convertWords(
  elevenLabsWords: ElevenLabsWord[],
): TranscriptionWord[] {
  return elevenLabsWords.map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    type: w.type,
    speakerId: w.speaker_id,
  }));
}

/**
 * 1文字単位の単語をフレーズ単位にマージする
 * 日本語ではElevenLabsが1文字ずつwordを返すため、
 * 句読点・時間間隔・話者変更をフレーズの区切りとして結合する
 */
export function mergeWordsIntoPhrases(
  words: TranscriptionWord[],
): TranscriptionWord[] {
  if (words.length === 0) return [];

  const phrases: TranscriptionWord[] = [];
  let current: TranscriptionWord = { ...words[0] };

  for (let i = 1; i < words.length; i++) {
    const word = words[i];

    if (word.type !== 'word') {
      phrases.push(current);
      phrases.push({ ...word });
      if (i + 1 < words.length) {
        current = { ...words[++i] };
      }
      continue;
    }

    if (word.speakerId !== current.speakerId) {
      phrases.push(current);
      current = { ...word };
      continue;
    }

    if (PHRASE_BREAK_CHARS.test(current.text.slice(-1))) {
      phrases.push(current);
      current = { ...word };
      continue;
    }

    if (word.start - current.end > PHRASE_GAP_THRESHOLD) {
      phrases.push(current);
      current = { ...word };
      continue;
    }

    current.text += word.text;
    current.end = word.end;
  }

  phrases.push(current);
  return phrases;
}

/** 単語データから話者情報を構築 */
export function buildSpeakers(words: TranscriptionWord[]): Speaker[] {
  const speakerIds = [...new Set(words.map((w) => w.speakerId))].sort();
  return speakerIds.map((id, index) => ({
    id,
    name: generateSpeakerName(index),
    color: SPEAKER_COLORS[index] ?? '#6B7280',
  }));
}

/** 単語データを発話セグメントにグループ化 */
export function groupWordsIntoUtterances(
  words: TranscriptionWord[],
  speakers: Speaker[],
): Utterance[] {
  const utterances: Utterance[] = [];
  let current: Utterance | null = null;

  for (const word of words) {
    if (!current || current.speakerId !== word.speakerId) {
      const speaker = speakers.find((s) => s.id === word.speakerId);
      current = {
        speakerId: word.speakerId,
        speakerName: speaker?.name ?? word.speakerId,
        start: word.start,
        end: word.end,
        text: word.text,
        words: [word],
      };
      utterances.push(current);
    } else {
      current.end = word.end;
      current.text += word.text;
      current.words.push(word);
    }
  }

  return utterances;
}
