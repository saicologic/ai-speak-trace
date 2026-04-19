import { ElevenLabsWord } from './types/elevenlabs.types';
import { ChunkedTranscriptionJob } from './types/chunked-job.types';

/** 単語のタイムスタンプをオフセット分調整 */
export function adjustTimestamps(
  words: ElevenLabsWord[],
  offsetSec: number,
): ElevenLabsWord[] {
  if (offsetSec === 0) return words;
  return words.map((w) => ({
    ...w,
    start: w.start + offsetSec,
    end: w.end + offsetSec,
  }));
}

/** 配列内で最も頻出する要素を返す */
export function getMostFrequent(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let maxCount = 0;
  let maxItem = arr[0];
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  }
  return maxItem;
}

/** 2つの話者IDを入れ替える */
export function swapSpeakerIds(
  words: ElevenLabsWord[],
  speakerA: string,
  speakerB: string,
): ElevenLabsWord[] {
  return words.map((w) => ({
    ...w,
    speaker_id:
      w.speaker_id === speakerA
        ? speakerB
        : w.speaker_id === speakerB
          ? speakerA
          : w.speaker_id,
  }));
}

/**
 * 前チャンクの話者IDと現チャンクの話者IDの対応を解決する
 * ElevenLabsはチャンクごとに独立して話者を割り当てるため、
 * 前チャンクの末尾の話者と現チャンクの先頭の話者を比較して、
 * 必要に応じてswapする
 */
export function resolveSpeakerMapping(
  prevChunkWords: ElevenLabsWord[],
  currentChunkWords: ElevenLabsWord[],
): ElevenLabsWord[] {
  const prevWordEntries = prevChunkWords.filter((w) => w.type === 'word');
  const currentWordEntries = currentChunkWords.filter((w) => w.type === 'word');

  if (prevWordEntries.length === 0 || currentWordEntries.length === 0) {
    return currentChunkWords;
  }

  const currentSpeakers = [
    ...new Set(currentWordEntries.map((w) => w.speaker_id)),
  ];

  if (currentSpeakers.length <= 1) {
    return currentChunkWords;
  }

  const prevTailWords = prevWordEntries.slice(-20);
  const prevTailSpeakers = prevTailWords.map((w) => w.speaker_id);
  const prevDominantSpeaker = getMostFrequent(prevTailSpeakers);

  const currentHeadWords = currentWordEntries.slice(0, 20);
  const currentHeadSpeakers = currentHeadWords.map((w) => w.speaker_id);
  const currentDominantSpeaker = getMostFrequent(currentHeadSpeakers);

  if (prevDominantSpeaker === currentDominantSpeaker) {
    return currentChunkWords;
  }

  const prevLastTime = prevWordEntries[prevWordEntries.length - 1].end;
  const currentFirstTime = currentWordEntries[0].start;
  const gapSec = currentFirstTime - prevLastTime;

  if (gapSec < 5) {
    // 前チャンクの支配的話者が現チャンクでは別IDに割り当てられている
    // → currentDominantSpeaker と prevDominantSpeaker をswapする
    return swapSpeakerIds(
      currentChunkWords,
      currentDominantSpeaker,
      prevDominantSpeaker,
    );
  }

  return currentChunkWords;
}

/** 全チャンクの結果をマージ */
export function mergeChunkResults(job: ChunkedTranscriptionJob): {
  words: ElevenLabsWord[];
  text: string;
  languageCode: string;
} {
  const allWords: ElevenLabsWord[] = [];
  const allTexts: string[] = [];
  let languageCode = 'ja';

  const sortedChunks = [...job.completedChunks].sort(
    (a, b) => a.index - b.index,
  );

  for (const chunk of sortedChunks) {
    allWords.push(...chunk.words);
    allTexts.push(chunk.text);
    languageCode = chunk.languageCode;
  }

  return {
    words: allWords,
    text: allTexts.join(''),
    languageCode,
  };
}
