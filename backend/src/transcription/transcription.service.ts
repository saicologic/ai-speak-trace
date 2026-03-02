import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ElevenLabsService } from './elevenlabs.service';
import { TranscriptionStoreService } from './transcription-store.service';
import { ElevenLabsWord } from './types/elevenlabs.types';
import {
  AudioFileInfo,
  Speaker,
  Transcription,
  TranscriptionWord,
  Utterance,
} from './types/transcription.types';

/** 対応する音声・動画ファイル拡張子（ElevenLabs Scribe v2 対応フォーマット） */
const AUDIO_EXTENSIONS = [
  // 音声
  '.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm',
  '.aac', '.aiff', '.opus', '.mp4',
  // 動画（音声を抽出して文字起こし）
  '.avi', '.mkv', '.mov', '.wmv', '.flv', '.mpeg', '.3gpp',
];

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
  private readonly outputsDir: string;

  constructor(
    private readonly elevenLabsService: ElevenLabsService,
    private readonly store: TranscriptionStoreService,
    private readonly configService: ConfigService,
  ) {
    this.outputsDir = path.resolve(
      this.configService.get<string>('OUTPUTS_DIR') ||
        path.join(__dirname, '..', '..', '..', 'outputs'),
    );
  }

  /** outputs/ フォルダ内の音声ファイル一覧を取得 */
  async getAudioFiles(): Promise<AudioFileInfo[]> {
    if (!existsSync(this.outputsDir)) {
      return [];
    }

    const files = await fs.readdir(this.outputsDir);
    const audioFiles: AudioFileInfo[] = [];

    for (const fileName of files) {
      const ext = path.extname(fileName).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) {
        continue;
      }

      const filePath = path.join(this.outputsDir, fileName);
      const stat = await fs.stat(filePath);

      audioFiles.push({
        fileName,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }

    // 更新日時の降順でソート
    audioFiles.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() -
        new Date(a.lastModified).getTime(),
    );

    return audioFiles;
  }

  /** 音声ファイルを文字起こし */
  async transcribe(fileName: string): Promise<Transcription> {
    const filePath = path.join(this.outputsDir, fileName);

    // ファイルの存在確認
    if (!existsSync(filePath)) {
      throw new NotFoundException(
        `音声ファイルが見つかりません: ${fileName}`,
      );
    }

    // ElevenLabs APIで文字起こし
    const result = await this.elevenLabsService.transcribe(filePath);

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

    // 話者名を更新
    for (const update of speakers) {
      const speaker = transcription.speakers.find((s) => s.id === update.id);
      if (speaker) {
        speaker.name = update.name;
      }
    }

    // 発話セグメントの話者名も連動更新
    for (const utterance of transcription.utterances) {
      const speaker = transcription.speakers.find(
        (s) => s.id === utterance.speakerId,
      );
      if (speaker) {
        utterance.speakerName = speaker.name;
      }
    }

    // 保存
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

      // spacing や audio_event はそのまま独立して追加
      if (word.type !== 'word') {
        phrases.push(current);
        phrases.push({ ...word });
        // 次のwordで新しいフレーズを開始するためリセット
        if (i + 1 < words.length) {
          current = { ...words[++i] };
        }
        continue;
      }

      // 話者が変わったら区切る
      if (word.speakerId !== current.speakerId) {
        phrases.push(current);
        current = { ...word };
        continue;
      }

      // 前のwordの末尾が句読点なら区切る
      if (PHRASE_BREAK_CHARS.test(current.text.slice(-1))) {
        phrases.push(current);
        current = { ...word };
        continue;
      }

      // 時間的に離れていたら区切る
      if (word.start - current.end > PHRASE_GAP_THRESHOLD) {
        phrases.push(current);
        current = { ...word };
        continue;
      }

      // 同じフレーズとして結合
      current.text += word.text;
      current.end = word.end;
    }

    // 最後のフレーズを追加
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
        // 新しい発話セグメントを開始
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
        // 同一話者の発話を追加
        current.end = word.end;
        current.text += word.text;
        current.words.push(word);
      }
    }

    return utterances;
  }
}
