import { describe, it, expect } from 'vitest';
import { formatTime, formatDuration, estimateCredits, CREDITS_PER_MINUTE } from './transcription';
import type { ChunkedJobDetail } from '../api/client';

describe('formatTime', () => {
  it('秒を mm:ss 形式にフォーマットする', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(3661)).toBe('61:01');
  });

  it('1桁の秒は0埋めする', () => {
    expect(formatTime(61)).toBe('1:01');
    expect(formatTime(609)).toBe('10:09');
  });

  it('小数秒は切り捨てる', () => {
    expect(formatTime(1.9)).toBe('0:01');
  });
});

describe('formatDuration', () => {
  it('1時間未満は「X分Y秒」形式', () => {
    expect(formatDuration(90)).toBe('1分30秒');
    expect(formatDuration(3599)).toBe('59分59秒');
  });

  it('1分未満は「X秒」形式', () => {
    expect(formatDuration(45)).toBe('45秒');
    expect(formatDuration(0)).toBe('0秒');
  });

  it('1時間以上は「X時間Y分」形式', () => {
    expect(formatDuration(3600)).toBe('1時間');
    expect(formatDuration(3660)).toBe('1時間1分');
    expect(formatDuration(7200)).toBe('2時間');
    expect(formatDuration(7320)).toBe('2時間2分');
  });

  it('端数の秒は四捨五入する', () => {
    expect(formatDuration(30.4)).toBe('30秒');
    expect(formatDuration(30.5)).toBe('31秒');
  });
});

describe('estimateCredits', () => {
  const makeJob = (totalChunks: number, completedCount: number, chunkDurationSec = 600): ChunkedJobDetail => ({
    id: 'job-1',
    audioFileName: 'test.mp3',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'transcribing',
    totalDurationSec: totalChunks * chunkDurationSec,
    chunkDurationSec,
    totalChunks,
    currentChunkIndex: completedCount,
    completedChunks: Array.from({ length: completedCount }, (_, i) => ({
      index: i,
      chunkFileName: `chunk-${i}.mp3`,
      startTimeSec: i * chunkDurationSec,
      text: `テキスト${i}`,
      languageCode: 'ja',
    })),
    updatedAt: '2024-01-01T00:00:00Z',
    isProcessing: false,
  });

  it('残りチャンクから必要クレジットを計算する', () => {
    const job = makeJob(6, 3, 600);
    // 残り3チャンク × 600秒/チャンク = 1800秒 = 30分 × 40クレジット/分 = 1200
    expect(estimateCredits(job)).toBe(1200);
  });

  it('全チャンク完了時は0クレジット', () => {
    const job = makeJob(3, 3, 600);
    expect(estimateCredits(job)).toBe(0);
  });

  it('chunkDurationSecのデフォルトは600秒', () => {
    const job = makeJob(2, 1);
    // 残り1チャンク × 600秒 = 600秒 = 10分 × 40 = 400
    expect(estimateCredits(job)).toBe(400);
  });

  it('CREDITS_PER_MINUTEは40', () => {
    expect(CREDITS_PER_MINUTE).toBe(40);
  });
});
