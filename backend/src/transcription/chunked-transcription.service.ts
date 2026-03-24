import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ElevenLabsService } from './elevenlabs.service';
import { AudioSplitterService, DEFAULT_CHUNK_DURATION_SEC } from './audio-splitter.service';
import { ChunkedJobStoreService } from './chunked-job-store.service';
import { ElevenLabsWord } from './types/elevenlabs.types';
import {
  ChunkedTranscriptionJob,
  CompletedChunk,
} from './types/chunked-job.types';

/** チャンク間のレート制限回避のための待機時間（ミリ秒） */
const INTER_CHUNK_DELAY_MS = 1000;

/** 指定ミリ秒待機するユーティリティ */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** チャンク分割文字起こしのオーケストレーションサービス */
@Injectable()
export class ChunkedTranscriptionService {
  private readonly logger = new Logger(ChunkedTranscriptionService.name);
  // 現在このプロセスで処理中のジョブIDを追跡（メモリ上のみ）
  private readonly processingJobIds = new Set<string>();

  constructor(
    private readonly elevenLabsService: ElevenLabsService,
    private readonly audioSplitter: AudioSplitterService,
    private readonly jobStore: ChunkedJobStoreService,
  ) {}

  /** 音声ファイルがチャンク分割を必要とするか判定（10分超） */
  async needsChunking(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<{ needs: boolean; durationSec: number }> {
    // 一時ファイルに書き出して長さを取得
    const chunksBaseDir = this.jobStore.getChunksBaseDir();
    const tempDir = path.join(chunksBaseDir, '_temp_probe');
    const ext = path.extname(fileName) || '.m4a';
    const tempPath = path.join(tempDir, `probe${ext}`);

    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(tempPath, fileBuffer);
      const durationSec = await this.audioSplitter.getAudioDuration(tempPath);
      return {
        needs: durationSec > DEFAULT_CHUNK_DURATION_SEC,
        durationSec,
      };
    } finally {
      await this.audioSplitter.cleanupChunks(tempDir);
    }
  }

  /** ジョブを早期作成して保存する（needsChunking判定前に呼ぶ） */
  async createJob(fileName: string): Promise<ChunkedTranscriptionJob> {
    const stem = path.parse(fileName).name;

    // 既存ジョブの状態を確認
    const existing = await this.jobStore.findById(stem);
    if (existing) {
      // 完了済みまたは処理中のジョブはリセットしない
      if (existing.status === 'completed' || this.processingJobIds.has(stem)) {
        this.logger.log(`既存ジョブをスキップ: jobId=${stem}, status=${existing.status}, processing=${this.processingJobIds.has(stem)}`);
        return existing;
      }
      // 未完了（failed, initializing, splitting, transcribing）のジョブはリセット
      this.logger.log(`既存ジョブをリセット: jobId=${stem}, status=${existing.status}`);
      existing.status = 'initializing';
      existing.totalDurationSec = 0;
      existing.totalChunks = 0;
      existing.currentChunkIndex = 0;
      existing.completedChunks = [];
      existing.errorMessage = undefined;
      existing.transcriptionId = undefined;
      await this.jobStore.save(existing);
      return existing;
    }

    const job: ChunkedTranscriptionJob = {
      id: stem,
      audioFileName: fileName,
      createdAt: new Date().toISOString(),
      status: 'initializing',
      totalDurationSec: 0,
      chunkDurationSec: DEFAULT_CHUNK_DURATION_SEC,
      totalChunks: 0,
      currentChunkIndex: 0,
      completedChunks: [],
      updatedAt: new Date().toISOString(),
    };
    await this.jobStore.save(job);
    this.logger.log(`ジョブ作成: jobId=${job.id}, fileName=${fileName}`);
    return job;
  }

  /** チャンク分割文字起こしを開始（既存ジョブを使用） */
  async startChunkedTranscription(
    job: ChunkedTranscriptionJob,
    fileBuffer: Buffer,
  ): Promise<{ mergedWords: ElevenLabsWord[]; mergedText: string; languageCode: string }> {
    const chunksDir = path.join(this.jobStore.getChunksBaseDir(), job.id);

    this.logger.log(`チャンク分割文字起こし開始: jobId=${job.id}, fileName=${job.audioFileName}`);
    this.processingJobIds.add(job.id);

    job.status = 'splitting';
    await this.jobStore.save(job);

    try {
      // 音声ファイルをチャンク分割
      const { chunkFiles, totalDurationSec } = await this.audioSplitter.splitAudio(
        fileBuffer,
        job.audioFileName,
        DEFAULT_CHUNK_DURATION_SEC,
        chunksDir,
      );

      job.totalDurationSec = totalDurationSec;
      job.totalChunks = chunkFiles.length;
      job.status = 'transcribing';
      await this.jobStore.save(job);

      // 各チャンクを順番に文字起こし
      await this.transcribeChunks(job, chunkFiles, 0);

      // 結果をマージ
      job.status = 'merging';
      await this.jobStore.save(job);

      const { words, text, languageCode } = this.mergeChunkResults(job);

      // 完了
      job.status = 'completed';
      await this.jobStore.save(job);

      // チャンクファイルを削除
      await this.audioSplitter.cleanupChunks(chunksDir);

      this.processingJobIds.delete(job.id);
      this.logger.log(
        `チャンク分割文字起こし完了: jobId=${job.id}, ${job.totalChunks}チャンク, ${words.length}単語`,
      );

      return { mergedWords: words, mergedText: text, languageCode };
    } catch (error) {
      this.processingJobIds.delete(job.id);
      job.status = 'failed';
      job.errorMessage = error instanceof Error ? error.message : String(error);
      await this.jobStore.save(job);
      this.logger.error(
        `チャンク分割文字起こし失敗: jobId=${job.id}, chunk=${job.currentChunkIndex}/${job.totalChunks}`,
        error instanceof Error ? error.stack : '',
      );
      throw error;
    }
  }

  /** 失敗または中断したジョブを途中から再開 */
  async resumeChunkedTranscription(
    jobId: string,
  ): Promise<{ job: ChunkedTranscriptionJob; mergedWords: ElevenLabsWord[]; mergedText: string; languageCode: string }> {
    const job = await this.jobStore.findById(jobId);
    if (!job) {
      throw new Error(`ジョブが見つかりません: ${jobId}`);
    }

    if (job.status === 'transcribing') {
      // sidecarはアプリと一体で起動・終了するため、
      // transcribing状態のジョブは前回プロセスで中断されたものとして扱う
      this.logger.warn(
        `中断ジョブを検出: jobId=${jobId}, 最終更新: ${job.updatedAt}`,
      );
    } else if (job.status === 'initializing' || job.status === 'splitting') {
      // 初期化中・分割中に中断されたジョブ: 最初からやり直す
      this.logger.warn(
        `初期段階で中断されたジョブを検出: jobId=${jobId}, status=${job.status}`,
      );
    } else if (job.status !== 'failed') {
      throw new Error(
        `再開できるのは失敗または中断したジョブのみです（現在の状態: ${job.status}）`,
      );
    }

    const chunksDir = path.join(this.jobStore.getChunksBaseDir(), jobId);
    const startIndex = job.completedChunks.length;

    this.logger.log(
      `チャンク分割文字起こし再開: jobId=${jobId}, チャンク${startIndex}/${job.totalChunks}から`,
    );

    // 残りのチャンクファイルパスを復元
    const ext = path.extname(job.audioFileName) || '.m4a';
    const chunkFiles: string[] = [];
    for (let i = 0; i < job.totalChunks; i++) {
      chunkFiles.push(
        path.join(chunksDir, `chunk_${String(i).padStart(3, '0')}${ext}`),
      );
    }

    this.processingJobIds.add(jobId);

    try {
      job.status = 'transcribing';
      job.errorMessage = undefined;
      await this.jobStore.save(job);

      // 未完了チャンクから再開
      await this.transcribeChunks(job, chunkFiles, startIndex);

      // 結果をマージ
      job.status = 'merging';
      await this.jobStore.save(job);

      const { words, text, languageCode } = this.mergeChunkResults(job);

      job.status = 'completed';
      await this.jobStore.save(job);

      // チャンクファイルを削除
      await this.audioSplitter.cleanupChunks(chunksDir);

      this.processingJobIds.delete(jobId);
      this.logger.log(
        `チャンク分割文字起こし再開完了: jobId=${jobId}, ${job.totalChunks}チャンク`,
      );

      return { job, mergedWords: words, mergedText: text, languageCode };
    } catch (error) {
      this.processingJobIds.delete(jobId);
      job.status = 'failed';
      job.errorMessage = error instanceof Error ? error.message : String(error);
      await this.jobStore.save(job);
      throw error;
    }
  }

  /** ジョブの進捗状態を取得 */
  async getJobStatus(jobId: string): Promise<ChunkedTranscriptionJob | null> {
    return this.jobStore.findById(jobId);
  }

  /** 指定ジョブが現在このプロセスで処理中かどうかを返す */
  isJobProcessing(jobId: string): boolean {
    return this.processingJobIds.has(jobId);
  }

  /** ファイル名で進行中のジョブを検索 */
  async findActiveJobByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob | null> {
    return this.jobStore.findActiveByFileName(fileName);
  }

  /** ファイル名で全ジョブ（完了・未完了含む）を検索 */
  async findAllJobsByFileName(
    fileName: string,
  ): Promise<ChunkedTranscriptionJob[]> {
    return this.jobStore.findAllJobsByFileName(fileName);
  }

  /** 再開可能なジョブ一覧を取得 */
  async getResumableJobs(): Promise<ChunkedTranscriptionJob[]> {
    return this.jobStore.findResumableJobs();
  }

  /** ジョブ状態を保存（外部から transcriptionId 等を記録する用） */
  async saveJob(job: ChunkedTranscriptionJob): Promise<void> {
    await this.jobStore.save(job);
  }

  /** ジョブを削除 */
  async deleteJob(jobId: string): Promise<void> {
    await this.jobStore.delete(jobId);
  }

  /** チャンクファイルのベースディレクトリを取得 */
  getChunksBaseDir(): string {
    return this.jobStore.getChunksBaseDir();
  }

  /** 指定範囲のチャンクを順番に文字起こし */
  private async transcribeChunks(
    job: ChunkedTranscriptionJob,
    chunkFiles: string[],
    startIndex: number,
  ): Promise<void> {
    for (let i = startIndex; i < chunkFiles.length; i++) {
      job.currentChunkIndex = i;
      await this.jobStore.save(job);

      const chunkPath = chunkFiles[i];
      const chunkBuffer = await fs.readFile(chunkPath);
      const chunkFileName = path.basename(chunkPath);

      this.logger.log(
        `チャンク ${i + 1}/${chunkFiles.length} 文字起こし開始: ${chunkFileName}`,
      );

      const result = await this.elevenLabsService.transcribe(
        chunkBuffer,
        chunkFileName,
      );

      // タイムスタンプをチャンクの開始位置分オフセット
      const startTimeSec = i * job.chunkDurationSec;
      const adjustedWords = this.adjustTimestamps(result.words, startTimeSec);

      // 話者IDの統一（2チャンク目以降）
      const finalWords =
        i > 0 && job.completedChunks.length > 0
          ? this.resolveSpeakerMapping(
              job.completedChunks[job.completedChunks.length - 1].words,
              adjustedWords,
            )
          : adjustedWords;

      const completedChunk: CompletedChunk = {
        index: i,
        chunkFileName,
        startTimeSec,
        words: finalWords,
        text: result.text,
        languageCode: result.language_code,
      };

      job.completedChunks.push(completedChunk);
      await this.jobStore.save(job);

      this.logger.log(
        `チャンク ${i + 1}/${chunkFiles.length} 文字起こし完了: ${result.words.length}単語`,
      );

      // チャンク間の待機（レート制限回避）
      if (i < chunkFiles.length - 1) {
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }
  }

  /** 単語のタイムスタンプをオフセット分調整 */
  private adjustTimestamps(
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

  /**
   * 前チャンクの話者IDと現チャンクの話者IDの対応を解決する
   * ElevenLabsはチャンクごとに独立して話者を割り当てるため、
   * 前チャンクの末尾の話者と現チャンクの先頭の話者を比較して、
   * 必要に応じてswapする
   */
  private resolveSpeakerMapping(
    prevChunkWords: ElevenLabsWord[],
    currentChunkWords: ElevenLabsWord[],
  ): ElevenLabsWord[] {
    // 前チャンクの末尾の話者を取得（spacing/audio_eventを除く）
    const prevWordEntries = prevChunkWords.filter((w) => w.type === 'word');
    const currentWordEntries = currentChunkWords.filter((w) => w.type === 'word');

    if (prevWordEntries.length === 0 || currentWordEntries.length === 0) {
      return currentChunkWords;
    }

    // 前チャンク末尾の話者ID
    const prevLastSpeaker = prevWordEntries[prevWordEntries.length - 1].speaker_id;

    // 現チャンク先頭の話者ID
    const currentFirstSpeaker = currentWordEntries[0].speaker_id;

    // ユニークな話者IDを収集
    const currentSpeakers = [...new Set(currentWordEntries.map((w) => w.speaker_id))];

    // 話者が1人だけの場合はswap不要
    if (currentSpeakers.length <= 1) {
      return currentChunkWords;
    }

    // 前チャンクの末尾の話者と現チャンクの先頭の話者が一致すれば
    // そのままの対応でOK（同じ人が続けて話している想定）
    // ただし、チャンク境界で話者が切り替わっている可能性もあるため、
    // 末尾数個の単語を見て多数派の話者で判定する
    const prevTailWords = prevWordEntries.slice(-20);
    const prevTailSpeakers = prevTailWords.map((w) => w.speaker_id);
    const prevDominantSpeaker = this.getMostFrequent(prevTailSpeakers);

    const currentHeadWords = currentWordEntries.slice(0, 20);
    const currentHeadSpeakers = currentHeadWords.map((w) => w.speaker_id);
    const currentDominantSpeaker = this.getMostFrequent(currentHeadSpeakers);

    // 前チャンク末尾で支配的な話者と、現チャンク先頭で支配的な話者が異なる場合、
    // 話者が入れ替わっている可能性がある → swap
    // ただし、実際には話者が切り替わった可能性もある
    // ここでは「同じ話者が続いている」ことを仮定してswapを判定
    if (prevDominantSpeaker === currentDominantSpeaker) {
      // 同じID → 対応OK、swapなし
      return currentChunkWords;
    }

    // IDが違うが、それが自然な割り当て違い（speaker_0 ↔ speaker_1の入れ替わり）か
    // 実際の話者交替かを区別するのは困難
    // ヒューリスティック: 前チャンク末尾と現チャンク先頭が連続する発話なら
    // 同一話者のはず → swapが必要
    // 時間的に連続しているかチェック（チャンク境界は通常連続）
    const prevLastTime = prevWordEntries[prevWordEntries.length - 1].end;
    const currentFirstTime = currentWordEntries[0].start;
    const gapSec = currentFirstTime - prevLastTime;

    // 5秒以内の間隔なら連続発話とみなし、swap実行
    if (gapSec < 5) {
      this.logger.log(
        `話者IDスワップ実行: ${currentSpeakers[0]} ↔ ${currentSpeakers[1]} (間隔: ${gapSec.toFixed(1)}秒)`,
      );
      return this.swapSpeakerIds(currentChunkWords, currentSpeakers[0], currentSpeakers[1]);
    }

    return currentChunkWords;
  }

  /** 配列内で最も頻出する要素を返す */
  private getMostFrequent(arr: string[]): string {
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
  private swapSpeakerIds(
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

  /** 全チャンクの結果をマージ */
  private mergeChunkResults(job: ChunkedTranscriptionJob): {
    words: ElevenLabsWord[];
    text: string;
    languageCode: string;
  } {
    const allWords: ElevenLabsWord[] = [];
    const allTexts: string[] = [];
    let languageCode = 'ja';

    // チャンクをインデックス順にソート
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
}
