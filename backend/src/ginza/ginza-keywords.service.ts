import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { SettingsService } from '../settings/settings.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { GinzaKeywordStore } from '../transcription/ginza-keyword-store.service';
import { GinzaEnvService } from './ginza-env.service';
import {
  RankedKeyword,
  hashTexts,
  rankKeywords,
  stripSoundTags,
} from './ginza-keywords.utils';

/** 1つの会話の解析にかけてよい時間 */
const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000;

/** GiNZA で取り出したキーワード（会話全体と話者ごと） */
export interface GinzaKeywords {
  keywords: RankedKeyword[];
  /** 話者 ID ごとのキーワード */
  bySpeaker: Record<string, RankedKeyword[]>;
}

/**
 * GiNZA でキーワードを取り出すサービス（ベータ機能）
 * 解析は手元の Python で行い、会話を外部に送らない。発話ごとの結果をキャッシュし、
 * 並べ替え（ほかの会話と比べる TF-IDF）は呼ばれるたびに行う
 */
@Injectable()
export class GinzaKeywordsService {
  private readonly logger = new Logger(GinzaKeywordsService.name);
  /** 解析中の会話（同じ会話を同時に解析しないため） */
  private readonly running = new Map<string, Promise<[string, string][][]>>();

  constructor(
    private readonly env: GinzaEnvService,
    private readonly settings: SettingsService,
    private readonly transcriptionService: TranscriptionService,
    private readonly transcriptionStore: TranscriptionStoreService,
    private readonly store: GinzaKeywordStore,
  ) {}

  /** ベータ機能が有効か確かめる */
  assertEnabled(): void {
    if (!this.settings.getSettings().enableGinzaKeywords) {
      throw new BadRequestException(
        'GiNZA のキーワード抽出は無効です。設定のベータ機能で有効にしてください',
      );
    }
  }

  async getKeywords(transcriptionId: string): Promise<GinzaKeywords> {
    this.assertEnabled();
    const status = await this.env.getStatus();
    if (status.state !== 'ready') {
      throw new ConflictException(status.message || 'GiNZA が入っていません');
    }
    const transcription =
      await this.transcriptionService.getTranscription(transcriptionId);
    const texts = transcription.utterances.map((u) => stripSoundTags(u.text));
    const terms = await this.getTerms(transcriptionId, texts);

    const others = (await this.transcriptionStore.findAll())
      .filter((t) => t.id !== transcriptionId)
      .map((t) => t.fullText);
    const rank = (indices: number[]) =>
      rankKeywords(
        indices.map((i) => terms[i]),
        indices.map((i) => texts[i]).join('\n'),
        others,
      );

    const all = texts.map((_, i) => i);
    const bySpeaker: Record<string, RankedKeyword[]> = {};
    for (const speaker of transcription.speakers) {
      bySpeaker[speaker.id] = rank(
        all.filter((i) => transcription.utterances[i].speakerId === speaker.id),
      );
    }
    return { keywords: rank(all), bySpeaker };
  }

  /** 発話ごとの語（キャッシュが古くなければキャッシュから） */
  private async getTerms(
    transcriptionId: string,
    texts: string[],
  ): Promise<[string, string][][]> {
    const engineHash = await this.env.engineHash();
    const textsHash = hashTexts(texts);
    const cached = await this.store.find(transcriptionId);
    if (
      cached &&
      cached.engineHash === engineHash &&
      cached.textsHash === textsHash &&
      cached.terms.length === texts.length
    ) {
      return cached.terms;
    }

    const key = `${transcriptionId}\u0000${textsHash}`;
    let job = this.running.get(key);
    if (!job) {
      job = this.env
        .syncScript()
        .then(() => this.analyze(texts))
        .then(async (terms) => {
          await this.store.save(transcriptionId, {
            engineHash,
            textsHash,
            terms,
          });
          return terms;
        })
        .finally(() => this.running.delete(key));
      this.running.set(key, job);
    }
    return job;
  }

  /** 手元の Python で GiNZA を動かす（テキストは標準入力で渡す） */
  private analyze(texts: string[]): Promise<[string, string][][]> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.env.pythonPath, [this.env.scriptPath], {
        env: {
          HOME: process.env.HOME ?? '',
          PATH: '/usr/bin:/bin',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('GiNZA の解析が時間内に終わりませんでした'));
      }, ANALYZE_TIMEOUT_MS);
      child.stdout.on('data', (d: Buffer) => stdout.push(d));
      child.stderr.on('data', (d: Buffer) => stderr.push(d));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf-8').slice(-500);
          this.logger.error(`GiNZA の解析に失敗しました: ${detail}`);
          reject(new Error('GiNZA の解析に失敗しました'));
          return;
        }
        try {
          const parsed = JSON.parse(
            Buffer.concat(stdout).toString('utf-8'),
          ) as {
            terms?: unknown;
          };
          if (!isTermLists(parsed.terms, texts.length)) {
            throw new Error('GiNZA の出力の形式が不正です');
          }
          this.logger.log(
            `GiNZA で解析しました: ${texts.length}件の発話、${Date.now() - started}ms`,
          );
          resolve(parsed.terms);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.stdin.end(JSON.stringify({ texts }));
    });
  }
}

/** Python の出力が、発話の数だけの [正規化した語, 表記] の一覧か */
function isTermLists(
  value: unknown,
  length: number,
): value is [string, string][][] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (list) =>
        Array.isArray(list) &&
        list.every(
          (t) =>
            Array.isArray(t) &&
            t.length === 2 &&
            typeof t[0] === 'string' &&
            typeof t[1] === 'string',
        ),
    )
  );
}
