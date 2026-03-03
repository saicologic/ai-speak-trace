import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { AUDIO_STORAGE } from '../storage/interfaces/audio-storage.interface';
import type { AudioStorage } from '../storage/interfaces/audio-storage.interface';
import { ElevenLabsWord } from './types/elevenlabs.types';
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

/** 文字起こしのビジネスロジックを担当するサービス */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(
    private readonly elevenLabsService: ElevenLabsService,
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

  /** 音声ファイルをアップロード */
  async uploadAudioFile(fileName: string, buffer: Buffer): Promise<void> {
    await this.audioStorage.saveFile(fileName, buffer);
    this.logger.log(`音声ファイルアップロード完了: ${fileName}`);
  }

  /** 音声ファイルを文字起こし */
  async transcribe(fileName: string): Promise<Transcription> {
    if (!(await this.audioStorage.exists(fileName))) {
      throw new NotFoundException(
        `音声ファイルが見つかりません: ${fileName}`,
      );
    }

    // ストレージから音声ファイルを読み込み
    const fileBuffer = await this.audioStorage.readFile(fileName);

    // ElevenLabs APIで文字起こし
    const result = await this.elevenLabsService.transcribe(fileBuffer, fileName);

    // ElevenLabsのレスポンスをアプリ内部型に変換
    const rawWords = this.convertWords(result.words);
    const words = this.mergeWordsIntoPhrases(rawWords);
    const speakers = this.buildSpeakers(words);
    const utterances = this.groupWordsIntoUtterances(words, speakers);

    const transcription: Transcription = {
      id: uuidv4(),
      audioFileName: fileName,
      createdAt: new Date().toISOString(),
      languageCode: result.language_code,
      fullText: result.text,
      speakers,
      words,
      utterances,
    };

    // 結果を保存
    await this.store.save(transcription);
    this.logger.log(`文字起こし完了: ${fileName} (ID: ${transcription.id})`);

    return transcription;
  }

  /** 文字起こし一覧を取得（サマリーのみ） */
  async getTranscriptions(): Promise<
    Pick<Transcription, 'id' | 'audioFileName' | 'createdAt'>[]
  > {
    const all = await this.store.findAll();
    return all
      .map((t) => ({
        id: t.id,
        audioFileName: t.audioFileName,
        createdAt: t.createdAt,
      }))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
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
