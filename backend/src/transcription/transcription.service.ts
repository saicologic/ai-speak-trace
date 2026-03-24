import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { ElevenLabsService } from './elevenlabs.service';
import { ChunkedTranscriptionService } from './chunked-transcription.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { AUDIO_STORAGE } from '../storage/interfaces/audio-storage.interface';
import type { AudioStorage } from '../storage/interfaces/audio-storage.interface';
import { ElevenLabsWord } from './types/elevenlabs.types';
import { ChunkedTranscriptionJob } from './types/chunked-job.types';
import {
  AudioFileInfo,
  Speaker,
  Transcription,
  TranscriptionWord,
  Utterance,
} from './types/transcription.types';

/** デフォルトの話者名 */
const DEFAULT_SPEAKER_NAMES = ['Aさん', 'Bさん'];

/** 話者の表示色 */
const SPEAKER_COLORS = ['#3B82F6', '#EF4444'];

/** フレーズ区切りとなる句読点パターン */
const PHRASE_BREAK_CHARS = /[。、！？!?,.\s]/;

/** フレーズ区切りとなる時間間隔（秒） */
const PHRASE_GAP_THRESHOLD = 0.5;

/** ファイルサイズ上限（3GB）: ElevenLabs APIのローカルアップロード上限 */
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024 * 1024;

/** 文字起こしのビジネスロジックを担当するサービス */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(
    private readonly elevenLabsService: ElevenLabsService,
    private readonly chunkedTranscriptionService: ChunkedTranscriptionService,
    private readonly store: TranscriptionStoreService,
    @Inject(AUDIO_STORAGE) private readonly audioStorage: AudioStorage,
  ) {}

  /** 音声ファイル一覧を取得 */
  async getAudioFiles(): Promise<AudioFileInfo[]> {
    const files = await this.audioStorage.listFiles();
    return files.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() -
        new Date(a.lastModified).getTime(),
    );
  }

  /** 音声ファイルの再生用URLを取得 */
  async getAudioFileUrl(fileName: string): Promise<string> {
    if (!(await this.audioStorage.exists(fileName))) {
      throw new NotFoundException(
        `音声ファイルが見つかりません: ${fileName}`,
      );
    }
    return this.audioStorage.getPlaybackUrl(fileName);
  }

  /** 音声ファイルの存在確認 */
  async checkAudioFileExists(fileName: string): Promise<boolean> {
    return this.audioStorage.exists(fileName);
  }

  /** 同名ファイルの全リソースを削除（音声ファイル + 全チャンクジョブ + 文字起こし履歴） */
  async deleteAllResourcesByFileName(fileName: string): Promise<void> {
    this.logger.log(`同名ファイルの全リソース削除開始: ${fileName}`);

    // 1. 音声ファイルを削除
    if (await this.audioStorage.exists(fileName)) {
      await this.audioStorage.deleteFile(fileName);
      this.logger.log(`音声ファイル削除完了: ${fileName}`);
    }

    // 2. 同名ファイルの全チャンクジョブを削除（completed, transcribing, failed 全て）
    const jobs = await this.chunkedTranscriptionService.findAllJobsByFileName(fileName);
    this.logger.log(`削除対象のジョブ: ${jobs.length}件`);
    for (const job of jobs) {
      await this.chunkedTranscriptionService.deleteJob(job.id);
      this.logger.log(`ジョブ削除完了: ${job.id} (status: ${job.status})`);
    }

    // 3. 文字起こし履歴を削除
    const allTranscriptions = await this.store.findAll();
    const matchedTranscriptions = allTranscriptions.filter(
      (t) => t.audioFileName === fileName,
    );
    this.logger.log(`削除対象の文字起こし履歴: ${matchedTranscriptions.length}件`);
    for (const transcription of matchedTranscriptions) {
      await this.store.delete(transcription.id);
      this.logger.log(`文字起こし履歴削除完了: ${transcription.id}`);
    }

    this.logger.log(`同名ファイルの全リソース削除完了: ${fileName}`);
  }

  /** アップロード用署名付きURLを取得 */
  async getUploadUrl(fileName: string): Promise<string | null> {
    return this.audioStorage.getUploadUrl(fileName);
  }

  /** 音声ファイルをアップロード */
  async uploadAudioFile(fileName: string, buffer: Buffer): Promise<void> {
    await this.audioStorage.saveFile(fileName, buffer);
    this.logger.log(`音声ファイルアップロード完了: ${fileName}`);
  }

  /** 音声ファイルを文字起こし */
  async transcribe(fileName: string): Promise<Transcription> {
    const startTime = Date.now();
    const elapsedSec = () => Math.round((Date.now() - startTime) / 1000);

    this.logger.log(`文字起こしパイプライン開始: ${fileName}`);

    if (!(await this.audioStorage.exists(fileName))) {
      this.logger.error(`音声ファイルが見つかりません: ${fileName}`);
      throw new NotFoundException(
        `音声ファイルが見つかりません: ${fileName}`,
      );
    }

    // ストレージから音声ファイルを読み込み
    const fileBuffer = await this.audioStorage.readFile(fileName);
    const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(1);
    this.logger.log(`音声ファイル読み込み完了: ${fileName} (${fileSizeMB} MB)`);

    // ファイルサイズ上限チェック（ElevenLabs APIのローカルアップロード上限: 3GB）
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `ファイルサイズが上限（3GB）を超えています（${fileSizeMB} MB）。音声ファイルを分割してください。`,
      );
    }

    // ジョブを早期作成（needsChunking判定前に保存し、中断時に再開可能にする）
    const chunkedJob = await this.chunkedTranscriptionService.createJob(fileName);

    // 音声の長さに応じて処理を分岐
    let elWords: ElevenLabsWord[];
    let fullText: string;
    let languageCode: string;

    const { needs: needsChunking } =
      await this.chunkedTranscriptionService.needsChunking(fileBuffer, fileName);

    if (needsChunking) {
      // 10分超: チャンク分割して順番に文字起こし
      this.logger.log(`チャンク分割モードで文字起こし: ${fileName}`);
      const chunkedResult =
        await this.chunkedTranscriptionService.startChunkedTranscription(
          chunkedJob,
          fileBuffer,
        );
      elWords = chunkedResult.mergedWords;
      fullText = chunkedResult.mergedText;
      languageCode = chunkedResult.languageCode;
    } else {
      // 10分以下: 従来通り一括で文字起こし（ジョブは不要なので削除）
      await this.chunkedTranscriptionService.deleteJob(chunkedJob.id);
      const result = await this.elevenLabsService.transcribe(fileBuffer, fileName);
      elWords = result.words;
      fullText = result.text;
      languageCode = result.language_code;
    }

    // ElevenLabsのレスポンスをアプリ内部型に変換
    const rawWords = this.convertWords(elWords);
    const words = this.mergeWordsIntoPhrases(rawWords);
    const speakers = this.buildSpeakers(words);
    const utterances = this.groupWordsIntoUtterances(words, speakers);
    this.logger.log(`データ変換完了: ${rawWords.length} 単語 → ${words.length} フレーズ, ${speakers.length} 名, ${utterances.length} セグメント`);

    const stem = path.parse(fileName).name;
    const transcription: Transcription = {
      id: stem,
      audioFileName: fileName,
      createdAt: new Date().toISOString(),
      languageCode,
      fullText,
      speakers,
      words,
      utterances,
    };

    // 結果を保存
    await this.store.save(transcription);

    // チャンクジョブにtranscriptionIdを記録（JobProgressPageからの完了検知用）
    if (needsChunking) {
      chunkedJob.transcriptionId = transcription.id;
      await this.chunkedTranscriptionService.saveJob(chunkedJob);
    }

    this.logger.log(`文字起こしパイプライン完了: ${fileName} (ID: ${transcription.id}, 所要時間: ${elapsedSec()}秒)`);

    return transcription;
  }

  /** 失敗したチャンクジョブを途中から再開 */
  async resumeTranscription(jobId: string): Promise<Transcription> {
    const startTime = Date.now();
    const elapsedSec = () => Math.round((Date.now() - startTime) / 1000);

    this.logger.log(`文字起こし再開: jobId=${jobId}`);

    // ジョブの状態を確認
    const existingJob = await this.chunkedTranscriptionService.getJobStatus(jobId);
    if (!existingJob) {
      throw new NotFoundException(`ジョブが見つかりません: ${jobId}`);
    }

    let mergedWords: ElevenLabsWord[];
    let mergedText: string;
    let languageCode: string;
    let job: ChunkedTranscriptionJob;

    if (existingJob.status === 'initializing' || existingJob.status === 'splitting') {
      // 初期段階で中断されたジョブ: 音声ファイルを再読み込みして最初からやり直す
      this.logger.log(`初期段階からの再開: ${existingJob.audioFileName}`);
      const fileBuffer = await this.audioStorage.readFile(existingJob.audioFileName);
      const result = await this.chunkedTranscriptionService.startChunkedTranscription(
        existingJob,
        fileBuffer,
      );
      mergedWords = result.mergedWords;
      mergedText = result.mergedText;
      languageCode = result.languageCode;
      job = existingJob;
    } else {
      // transcribing/failed: チャンクの途中から再開
      const result =
        await this.chunkedTranscriptionService.resumeChunkedTranscription(jobId);
      mergedWords = result.mergedWords;
      mergedText = result.mergedText;
      languageCode = result.languageCode;
      job = result.job;
    }

    // ElevenLabsのレスポンスをアプリ内部型に変換
    const rawWords = this.convertWords(mergedWords);
    const words = this.mergeWordsIntoPhrases(rawWords);
    const speakers = this.buildSpeakers(words);
    const utterances = this.groupWordsIntoUtterances(words, speakers);

    const resumeStem = path.parse(job.audioFileName).name;
    const transcription: Transcription = {
      id: resumeStem,
      audioFileName: job.audioFileName,
      createdAt: new Date().toISOString(),
      languageCode,
      fullText: mergedText,
      speakers,
      words,
      utterances,
    };

    await this.store.save(transcription);

    // チャンクジョブにtranscriptionIdを記録
    job.transcriptionId = transcription.id;
    await this.chunkedTranscriptionService.saveJob(job);

    this.logger.log(`文字起こし再開完了: ${job.audioFileName} (ID: ${transcription.id}, 所要時間: ${elapsedSec()}秒)`);

    return transcription;
  }

  /** チャンクジョブの進捗を取得 */
  async getChunkedJobStatus(jobId: string): Promise<ChunkedTranscriptionJob | null> {
    return this.chunkedTranscriptionService.getJobStatus(jobId);
  }

  /** ファイル名で進行中のチャンクジョブを検索 */
  async findActiveJob(fileName: string): Promise<ChunkedTranscriptionJob | null> {
    return this.chunkedTranscriptionService.findActiveJobByFileName(fileName);
  }

  /** 再開可能なジョブ一覧を取得 */
  async getResumableJobs(): Promise<ChunkedTranscriptionJob[]> {
    return this.chunkedTranscriptionService.getResumableJobs();
  }

  /** ジョブ詳細を取得（completedChunksのテキスト含む） */
  async getJobDetail(jobId: string): Promise<ChunkedTranscriptionJob | null> {
    return this.chunkedTranscriptionService.getJobStatus(jobId);
  }

  /** 指定ジョブが現在このプロセスで処理中かどうかを返す */
  isJobProcessing(jobId: string): boolean {
    return this.chunkedTranscriptionService.isJobProcessing(jobId);
  }

  /** ジョブを削除 */
  async deleteJob(jobId: string): Promise<void> {
    return this.chunkedTranscriptionService.deleteJob(jobId);
  }

  /** チャンクファイルのベースディレクトリを取得 */
  getChunksBaseDir(): string {
    return this.chunkedTranscriptionService.getChunksBaseDir();
  }

  /** 文字起こし一覧を取得（サマリーのみ） */
  async getTranscriptions(): Promise<
    Pick<Transcription, 'id' | 'audioFileName' | 'createdAt'>[]
  > {
    this.logger.log('getTranscriptions 開始');
    const all = await this.store.findAll();
    this.logger.log(`getTranscriptions: store.findAll() から ${all.length} 件取得`);
    const result = all
      .map((t) => ({
        id: t.id,
        audioFileName: t.audioFileName,
        createdAt: t.createdAt,
      }))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    this.logger.log(`getTranscriptions 完了: ${result.length} 件返却`);
    return result;
  }

  /** 文字起こし結果をIDで取得 */
  async getTranscription(id: string): Promise<Transcription> {
    const transcription = await this.store.findById(id);
    if (!transcription) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${id}`,
      );
    }
    return transcription;
  }

  /** 話者名を更新 */
  async updateSpeakers(
    id: string,
    speakers: { id: string; name: string }[],
  ): Promise<Transcription> {
    const transcription = await this.getTranscription(id);

    for (const update of speakers) {
      const speaker = transcription.speakers.find((s) => s.id === update.id);
      if (speaker) {
        speaker.name = update.name;
      }
    }

    for (const utterance of transcription.utterances) {
      const speaker = transcription.speakers.find(
        (s) => s.id === utterance.speakerId,
      );
      if (speaker) {
        utterance.speakerName = speaker.name;
      }
    }

    await this.store.save(transcription);
    this.logger.log(`話者名更新完了: ${id}`);

    return transcription;
  }

  /** ElevenLabsの単語データをアプリ内部型に変換 */
  private convertWords(elevenLabsWords: ElevenLabsWord[]): TranscriptionWord[] {
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
  private mergeWordsIntoPhrases(
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
  private buildSpeakers(words: TranscriptionWord[]): Speaker[] {
    const speakerIds = [...new Set(words.map((w) => w.speakerId))].sort();
    return speakerIds.map((id, index) => ({
      id,
      name: DEFAULT_SPEAKER_NAMES[index] ?? `話者${index + 1}`,
      color: SPEAKER_COLORS[index] ?? '#6B7280',
    }));
  }

  /** 単語データを発話セグメントにグループ化 */
  private groupWordsIntoUtterances(
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
}
