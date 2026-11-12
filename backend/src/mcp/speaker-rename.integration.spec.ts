import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GinzaKeywordStore } from '../transcription/ginza-keyword-store.service';
import {
  GuardrailFindings,
  GuardrailService,
} from '../privacy/guardrail.service';
import { PrivacyScanStore } from '../privacy/privacy-scan.store';
import { PrivacyService } from '../privacy/privacy.service';
import { AudioStorage } from '../storage/interfaces/audio-storage.interface';
import { LocalTranscriptionStorage } from '../storage/local/local-transcription-storage';
import { ChunkedTranscriptionService } from '../transcription/chunked-transcription.service';
import { DerivedLogCleaner } from '../transcription/derived-log-cleaner.service';
import { ElevenLabsService } from '../transcription/elevenlabs.service';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { Transcription } from '../transcription/types/transcription.types';
import { UtteranceEmbeddingStore } from '../transcription/utterance-embedding-store.service';
import {
  ConversationReader,
  SPEAKER_NAMES_HIDDEN_NOTICE,
} from './conversation-reader';

/**
 * アプリで話者名を変えてから、個人情報チェックをし直すまでの間に、MCP が何を返すかを、
 * アプリの本物の部品（文字起こしの保存・話者名の変更・個人情報チェック）と MCP の読み方をつないで確かめる。
 * Guardrails だけは、応答を返す時をテストで決められる偽物にする（AWS は使わない）
 */

/** テスト用の架空の会話（実在の人・会社の会話ではない） */
function makeTranscription(
  createdAt = '2026-11-08T02:39:19.324Z',
): Transcription {
  const lines: [string, string][] = [
    ['speaker_0', '最近は仕様を先に書いてから実装しています'],
    ['speaker_1', 'テストはいつ書いていますか'],
  ];
  const names: Record<string, string> = {
    speaker_0: 'Aさん',
    speaker_1: 'Bさん',
  };
  return {
    id: 'rename-talk',
    audioFileName: 'rename-talk.mp3',
    createdAt,
    languageCode: 'ja',
    fullText: lines.map(([, t]) => t).join(' '),
    speakers: [
      { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
      { id: 'speaker_1', name: 'Bさん', color: '#10B981' },
    ],
    words: [],
    utterances: lines.map(([speakerId, text], i) => ({
      speakerId,
      speakerName: names[speakerId],
      start: i * 10,
      end: i * 10 + 9,
      text,
      words: [],
    })),
  };
}

const noFindings = (): GuardrailFindings => ({
  pii: [],
  words: [],
  content: [],
});

/** 応答を返す時をテストで決められる、Guardrails の偽物 */
class FakeGuardrail {
  readonly guardrailId = 'test-guardrail';
  readonly guardrailVersion = 'DRAFT';
  private pending: {
    resolve: (f: GuardrailFindings) => void;
    reject: (e: Error) => void;
  }[] = [];
  /** true の間は、応答を返さずに待たせる */
  hold = false;
  /** すぐに返すときの検出 */
  findings: GuardrailFindings = noFindings();

  isConfigured() {
    return true;
  }

  inspect(): Promise<GuardrailFindings> {
    if (!this.hold) return Promise.resolve(this.findings);
    return new Promise((resolve, reject) =>
      this.pending.push({ resolve, reject }),
    );
  }

  /** 待たせている確認に、検出を返す */
  release(findings: GuardrailFindings = noFindings()) {
    this.hold = false;
    for (const p of this.pending.splice(0)) p.resolve(findings);
  }

  /** 待たせている確認を、失敗させる */
  fail() {
    this.hold = false;
    for (const p of this.pending.splice(0)) p.reject(new Error('AccessDenied'));
  }

  get waiting() {
    return this.pending.length;
  }
}

/** 待っている非同期の処理を進める */
async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('話者名を変えてから個人情報チェックをし直すまでの、MCP の返す内容（アプリと MCP をつないだ確認）', () => {
  let dataDir: string;
  let guardrail: FakeGuardrail;
  let privacy: PrivacyService;
  let store: TranscriptionStoreService;
  let transcriptions: TranscriptionService;
  let reader: ConversationReader;

  /** MCP の一覧で、この会話の1件 */
  const entry = async () => {
    const entries = await reader.list();
    expect(entries).toHaveLength(1);
    return entries[0];
  };
  const speakerNames = async () =>
    (await entry()).conversation?.transcription.speakers.map((s) => s.name);

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaker-rename-'));
    const config = new ConfigService({ DATA_DIR: dataDir });
    guardrail = new FakeGuardrail();
    privacy = new PrivacyService(
      guardrail as unknown as GuardrailService,
      new PrivacyScanStore(config),
    );
    store = new TranscriptionStoreService(
      new LocalTranscriptionStorage(config),
      { delete: () => Promise.resolve() } as unknown as UtteranceEmbeddingStore,
      new DerivedLogCleaner(config),
      { delete: () => Promise.resolve() } as unknown as GinzaKeywordStore,
      privacy,
    );
    transcriptions = new TranscriptionService(
      {} as ElevenLabsService,
      {} as ChunkedTranscriptionService,
      store,
      {} as AudioStorage,
      privacy,
    );
    reader = new ConversationReader(dataDir);

    // 文字起こしを保存し、個人情報チェックを済ませる
    const t = makeTranscription();
    await store.save(t);
    await privacy.scan(t);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('チェック済みの会話は、話者名を返す', async () => {
    const e = await entry();
    expect(e.privacy).toBe('checked');
    expect(e.notice).toBeUndefined();
    expect(await speakerNames()).toEqual(['Aさん', 'Bさん']);
  });

  it('話者名を変えた直後（チェックし直しの途中）は、話者名を置き換えて返し、変えた名前を出さない', async () => {
    guardrail.hold = true;
    await transcriptions.updateSpeakers('rename-talk', [
      { id: 'speaker_0', name: '架空花子' },
    ]);
    await flush();
    // アプリはチェックし直しを始めていて、Guardrails の応答を待っている
    expect(guardrail.waiting).toBe(1);

    const e = await entry();
    expect(e.privacy).toBe('checked');
    expect(e.notice).toBe(SPEAKER_NAMES_HIDDEN_NOTICE);
    expect(await speakerNames()).toEqual(['話者1', '話者2']);
    expect(
      e.conversation?.transcription.utterances.map((u) => u.speakerName),
    ).toEqual(['話者1', '話者2']);
    expect(JSON.stringify(e)).not.toContain('架空花子');
    // 本文はチェック済みのため返す
    expect(e.conversation?.transcription.utterances[0].text).toBe(
      '最近は仕様を先に書いてから実装しています',
    );
  });

  it('チェックし直しが終わると、変えた名前を返す（検出されなかった名前）', async () => {
    guardrail.hold = true;
    await transcriptions.updateSpeakers('rename-talk', [
      { id: 'speaker_0', name: 'Cさん' },
    ]);
    await flush();
    guardrail.release();
    await privacy.waitForScans('rename-talk');

    const e = await entry();
    expect(e.privacy).toBe('checked');
    expect(e.notice).toBeUndefined();
    expect(await speakerNames()).toEqual(['Cさん', 'Bさん']);
  });

  it('チェックし直しで変えた名前が氏名として検出されたら、利用者が選ぶまで返さない（要確認）', async () => {
    guardrail.hold = true;
    await transcriptions.updateSpeakers('rename-talk', [
      { id: 'speaker_0', name: '架空花子' },
    ]);
    await flush();
    guardrail.release({
      ...noFindings(),
      pii: [{ type: 'NAME', match: '架空花子' }],
    });
    await privacy.waitForScans('rename-talk');

    const e = await entry();
    expect(e.privacy).toBe('needs_review');
    expect(JSON.stringify(e)).not.toContain('架空花子');
  });

  it('チェックし直しに失敗したら、話者名は置き換えたままで、変えた名前を出さない', async () => {
    guardrail.hold = true;
    await transcriptions.updateSpeakers('rename-talk', [
      { id: 'speaker_0', name: '架空花子' },
    ]);
    await flush();
    guardrail.fail();
    await privacy.waitForScans('rename-talk');

    const e = await entry();
    expect(e.privacy).toBe('checked');
    expect(e.notice).toBe(SPEAKER_NAMES_HIDDEN_NOTICE);
    expect(JSON.stringify(e)).not.toContain('架空花子');
  });

  it('同じ id で文字起こしし直した会話は、前のチェックの結果では返さない（stale）', async () => {
    await store.save(makeTranscription('2026-11-12T10:00:00.000Z'));

    const e = await entry();
    expect(e.privacy).toBe('stale');
    expect(e.conversation).toBeUndefined();
  });
});
