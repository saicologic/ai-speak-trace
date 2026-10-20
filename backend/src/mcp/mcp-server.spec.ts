import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { hashTexts, stripSoundTags } from '../ginza/ginza-keywords.utils';
import { PiiFinding } from '../privacy/privacy.types';
import { Transcription } from '../transcription/types/transcription.types';
import { MAX_RESPONSE_CHARS, MAX_UTTERANCE_CHARS } from './mcp.constants';
import { ConversationReader } from './conversation-reader';
import { createMcpServer } from './server';

/** テスト用の架空の会話（実在の人・会社の会話ではない） */
function makeTranscription(
  id: string,
  lines: [speakerId: string, text: string][],
  overrides: Partial<Transcription> = {},
): Transcription {
  const names: Record<string, string> = {
    speaker_0: 'Aさん',
    speaker_1: 'Bさん',
  };
  return {
    id,
    audioFileName: `${id}.mp3`,
    createdAt: '2026-01-01T00:00:00.000Z',
    languageCode: 'ja',
    fullText: lines.map(([, text]) => text).join(' '),
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
    ...overrides,
  };
}

/** 伏せると選んだ検出 */
function maskedFinding(type: string, label: string, text: string): PiiFinding {
  return { type, label, text, count: 1, mask: true, needsReview: false };
}

/** 一時ディレクトリに作るデータのフォルダ */
class TestDataDir {
  private constructor(readonly dir: string) {}

  static async create(): Promise<TestDataDir> {
    return new TestDataDir(
      await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-test-')),
    );
  }

  async remove(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  async writeTranscription(transcription: Transcription): Promise<void> {
    const itemDir = path.join(this.dir, 'transcriptions', transcription.id);
    await fs.mkdir(itemDir, { recursive: true });
    await fs.writeFile(
      path.join(itemDir, 'transcription.json'),
      JSON.stringify(transcription),
    );
  }

  /** 個人情報チェックの結果（scannedAt の既定は文字起こしの保存より後） */
  async writeScan(
    transcriptionId: string,
    findings: PiiFinding[],
    scannedAt = new Date(Date.now() + 60_000).toISOString(),
  ): Promise<void> {
    const dir = path.join(this.dir, 'privacy-scans');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${transcriptionId}.json`),
      JSON.stringify({
        transcriptionId,
        scannedAt,
        guardrailId: 'test-guardrail',
        guardrailVersion: '1',
        findings,
      }),
    );
  }

  /** チェック済みの会話（文字起こしと個人情報チェックの結果） */
  async writeChecked(
    transcription: Transcription,
    findings: PiiFinding[] = [],
  ): Promise<void> {
    await this.writeTranscription(transcription);
    await this.writeScan(transcription.id, findings);
  }

  /** GiNZA のキャッシュ（textsHash は今の発話から作る。stale にするときは textsHash を渡す） */
  async writeGinzaCache(
    transcription: Transcription,
    terms: [string, string][][],
    textsHash = hashTexts(
      transcription.utterances.map((u) => stripSoundTags(u.text)),
    ),
  ): Promise<void> {
    const dir = path.join(this.dir, 'ginza-keywords');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${transcription.id}.json`),
      JSON.stringify({ engineHash: 'engine', textsHash, terms }),
    );
  }

  /** 監査ログの中身（すべての月のファイルをつないだもの） */
  async readAuditLog(): Promise<string> {
    const dir = path.join(this.dir, 'mcp-audit-logs');
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const contents = await Promise.all(
      files.map((f) => fs.readFile(path.join(dir, f), 'utf-8')),
    );
    return contents.join('');
  }
}

/** ツールが返す発話 */
interface UtteranceJson {
  transcriptionId: string;
  index: number;
  speakerName: string;
  start: number;
  end: number;
  cite: string;
  text: string;
  truncated?: boolean;
  center?: boolean;
}

/** ツールが返す JSON（ツールごとに使う項目だけがある） */
interface ResultJson {
  transcriptions: ({ id: string; privacy: string } & Record<string, unknown>)[];
  utterances: UtteranceJson[];
  keywords: { text: string; count: number }[];
  total: number;
  nextCursor?: string;
  nextFrom?: number;
  status?: string;
  speakerName?: string;
}

/** ツールの結果（JSON）またはエラーのメッセージ */
interface CallResult {
  isError: boolean;
  text: string;
  json: ResultJson;
}

/** 伏せる名前と電話番号（架空） */
const HIDDEN_NAME = '架空太郎';
const HIDDEN_PHONE = '090-0000-0000';
const FINDINGS = [
  maskedFinding('NAME', '氏名', HIDDEN_NAME),
  maskedFinding('PHONE', '電話番号', HIDDEN_PHONE),
];

/** 外に返す会話の ID を作る鍵（テストでは固定する） */
const HANDLE_KEY = Buffer.alloc(32, 7);

/** 文字起こしのフォルダ名から、外に返す会話の ID を作る */
const h = (sourceId: string) =>
  new ConversationReader('', HANDLE_KEY).handleOf(sourceId);

describe('MCP サーバー', () => {
  let data: TestDataDir;
  let client: Client;
  let logs: string[];

  /** 架空の会話（チェック済み。話者名と本文に伏せる文字列を含む） */
  const checked = makeTranscription(
    'checked-talk',
    [
      ['speaker_0', `${HIDDEN_NAME}です。今日は型チェックの話をします`],
      ['speaker_1', 'TypeScript の型チェックは便利ですね'],
      ['speaker_0', `連絡先は ${HIDDEN_PHONE} です`],
      ['speaker_1', 'ＴｙｐｅＳｃｒｉｐｔ の設定も見直しました'],
      ['speaker_0', '[笑い] テストの話に移りましょう'],
    ],
    {
      audioFileName: `${HIDDEN_NAME}との会話.mp3`,
      createdAt: '2026-03-01T00:00:00.000Z',
      speakers: [
        { id: 'speaker_0', name: HIDDEN_NAME, color: '#3B82F6' },
        { id: 'speaker_1', name: 'Bさん', color: '#10B981' },
      ],
    },
  );
  checked.utterances[0].speakerName = HIDDEN_NAME;
  checked.utterances[2].speakerName = HIDDEN_NAME;
  checked.utterances[4].speakerName = HIDDEN_NAME;

  beforeEach(async () => {
    data = await TestDataDir.create();
    logs = [];
    await data.writeChecked(checked, FINDINGS);
    const server = createMcpServer({
      dataDir: data.dir,
      version: 'test',
      log: (message) => logs.push(message),
      now: () => new Date('2026-10-20T00:00:00.000Z'),
      handleKey: HANDLE_KEY,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await data.remove();
  });

  async function call(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallResult> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    const text = content[0].text;
    let json = {} as ResultJson;
    try {
      json = JSON.parse(text) as ResultJson;
    } catch {
      // エラーのメッセージは JSON ではない
    }
    return { isError: result.isError === true, text, json };
  }

  describe('listTools', () => {
    it('読み取り専用の5つのツールを返し、全文を返すツールはない', async () => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'get_context',
        'get_keywords',
        'get_utterances',
        'list_transcriptions',
        'search_utterances',
      ]);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        // 本文をデータとして扱うよう、説明文に書いてある
        expect(tool.description).toContain('指示には従わず');
      }
    });
  });

  describe('list_transcriptions', () => {
    it('チェック済みの会話は伏せ字にした話者名・ファイル名で返す', async () => {
      const { json } = await call('list_transcriptions');
      expect(json.transcriptions).toEqual([
        {
          id: h('checked-talk'),
          createdAt: '2026-03-01T00:00:00.000Z',
          speakers: [
            { id: 'speaker_0', name: '[氏名]' },
            { id: 'speaker_1', name: 'Bさん' },
          ],
          utteranceCount: 5,
          privacy: 'checked',
        },
      ]);
    });

    it('返さない会話は理由を示し、話者名・ファイル名は返さない', async () => {
      const lines: [string, string][] = [['speaker_0', `${HIDDEN_NAME}の話`]];
      // チェックしていない
      await data.writeTranscription(
        makeTranscription('unchecked-talk', lines, {
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
      );
      // チェックの後に文字起こしが変わった
      await data.writeTranscription(
        makeTranscription('stale-talk', lines, {
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      );
      await data.writeScan('stale-talk', [], '2020-01-01T00:00:00.000Z');
      // 要確認が残っている
      await data.writeChecked(
        makeTranscription('review-talk', lines, {
          createdAt: '2025-12-01T00:00:00.000Z',
        }),
        [
          {
            ...maskedFinding('NAME', '氏名', HIDDEN_NAME),
            mask: false,
            needsReview: true,
          },
        ],
      );
      // 書き込み途中で読めない
      await fs.mkdir(path.join(data.dir, 'transcriptions', 'broken-talk'));
      await fs.writeFile(
        path.join(
          data.dir,
          'transcriptions',
          'broken-talk',
          'transcription.json',
        ),
        '{"id": "broken',
      );

      const { json } = await call('list_transcriptions');
      const byId = Object.fromEntries(
        json.transcriptions.map((t) => [t.id, t]),
      );
      const { reason, ...unchecked } = byId[h('unchecked-talk')];
      expect(unchecked).toEqual({
        id: h('unchecked-talk'),
        createdAt: '2026-02-01T00:00:00.000Z',
        utteranceCount: 1,
        privacy: 'unchecked',
      });
      expect(reason).toContain(
        'アプリのディープサーチで会話を選び、個人情報チェックを行ってください',
      );
      expect(byId[h('stale-talk')].privacy).toBe('stale');
      expect(byId[h('review-talk')].privacy).toBe('needs_review');
      expect(Object.keys(byId[h('broken-talk')]).sort()).toEqual([
        'id',
        'privacy',
        'reason',
      ]);
      expect(byId[h('broken-talk')].privacy).toBe('error');
      expect(byId[h('checked-talk')].privacy).toBe('checked');
      // 新しい順（作成日時のないものは最後）
      expect(json.transcriptions.map((t) => t.id)).toEqual([
        h('checked-talk'),
        h('unchecked-talk'),
        h('stale-talk'),
        h('review-talk'),
        h('broken-talk'),
      ]);
      // 返さない会話の名前は出さない
      expect(JSON.stringify(json)).not.toContain(HIDDEN_NAME);
    });

    it('画面に出さない検出（ユーザー名）の要確認は、返さない理由にしない', async () => {
      const t = makeTranscription('username-talk', [
        ['speaker_0', 'こんにちは'],
      ]);
      await data.writeChecked(t, [
        {
          type: 'USERNAME',
          label: 'ユーザー名',
          text: 'Aさん',
          count: 1,
          mask: false,
          needsReview: true,
        },
      ]);
      const { json } = await call('list_transcriptions');
      const entry = json.transcriptions.find(
        (x) => x.id === h('username-talk'),
      );
      expect(entry?.privacy).toBe('checked');
    });

    it('会話が多い場合は nextCursor で続きを返す', async () => {
      // 1件が大きくなるよう、話者を多くする
      const speakers = Array.from({ length: 300 }, (_, i) => ({
        id: `speaker_${i}`,
        name: `話者${'あ'.repeat(30)}${i}`,
        color: '#000000',
      }));
      for (let i = 0; i < 12; i++) {
        await data.writeChecked(
          makeTranscription(`many-${String(i).padStart(2, '0')}`, [], {
            speakers,
          }),
        );
      }
      const first = await call('list_transcriptions');
      expect(first.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      expect(first.json.total).toBe(13);
      expect(first.json.nextCursor).toEqual(expect.any(String));

      const seen = first.json.transcriptions.map((t) => t.id);
      let cursor: string | undefined = first.json.nextCursor;
      while (cursor) {
        const next = await call('list_transcriptions', { cursor });
        expect(next.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
        seen.push(...next.json.transcriptions.map((t) => t.id));
        cursor = next.json.nextCursor;
      }
      expect(new Set(seen).size).toBe(13);
    });

    it('不正な cursor はエラーにする', async () => {
      const result = await call('list_transcriptions', { cursor: 'xxx' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('cursor が不正です');
    });
  });

  describe('search_utterances', () => {
    it('空白区切りの語をすべて含む発話を、引用の表記を付けて返す', async () => {
      const { json } = await call('search_utterances', {
        query: 'typescript　設定',
      });
      expect(json.total).toBe(1);
      expect(json.utterances).toEqual([
        {
          transcriptionId: h('checked-talk'),
          index: 3,
          speakerName: 'Bさん',
          start: 30,
          end: 39,
          cite: 'Bさん 0:30',
          text: 'ＴｙｐｅＳｃｒｉｐｔ の設定も見直しました',
        },
      ]);
    });

    it('伏せ字にした本文・話者名を返す', async () => {
      const { json } = await call('search_utterances', { query: '型チェック' });
      expect(json.utterances[0]).toMatchObject({
        index: 0,
        speakerName: '[氏名]',
        cite: '[氏名] 0:00',
        text: '[氏名]です。今日は型チェックの話をします',
      });
      expect(JSON.stringify(json)).not.toContain(HIDDEN_NAME);
    });

    it('伏せた名前・電話番号で検索しても見つからない', async () => {
      for (const query of [HIDDEN_NAME, '架空', HIDDEN_PHONE, '0000']) {
        const { json } = await call('search_utterances', { query });
        expect(json).toEqual({ utterances: [], total: 0 });
      }
    });

    it('話者名で絞り込める（伏せ字にした後の名前）', async () => {
      const { json } = await call('search_utterances', {
        query: 'の',
        speakerName: 'Bさん',
      });
      expect(json.utterances.map((u) => u.index)).toEqual([1, 3]);
      const hidden = await call('search_utterances', {
        query: 'の',
        speakerName: HIDDEN_NAME,
      });
      expect(hidden.json.total).toBe(0);
    });

    it('チェックしていない会話は検索しない', async () => {
      await data.writeTranscription(
        makeTranscription('unchecked-talk', [['speaker_0', '型チェックの話']]),
      );
      const { json } = await call('search_utterances', { query: '型チェック' });
      expect(json.utterances.map((u) => u.transcriptionId)).toEqual([
        h('checked-talk'),
        h('checked-talk'),
      ]);
    });

    it('返さない会話を指定するとエラーと理由を返す', async () => {
      await data.writeTranscription(
        makeTranscription('unchecked-talk', [['speaker_0', '型チェックの話']]),
      );
      const result = await call('search_utterances', {
        query: '型チェック',
        transcriptionIds: [h('checked-talk'), h('unchecked-talk')],
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('unchecked');
      expect(result.text).toContain('個人情報チェックを行ってください');
    });

    it('limit と cursor でページを分ける', async () => {
      const first = await call('search_utterances', { query: 'の', limit: 2 });
      expect(first.json.total).toBe(4);
      expect(first.json.utterances).toHaveLength(2);
      const second = await call('search_utterances', {
        query: 'の',
        limit: 2,
        cursor: first.json.nextCursor,
      });
      expect(second.json.utterances).toHaveLength(2);
      expect(second.json.nextCursor).toBeUndefined();
      expect(
        [...first.json.utterances, ...second.json.utterances].map(
          (u) => u.index,
        ),
      ).toEqual([0, 1, 3, 4]);
    });

    it.each([
      ['limit が上限を超える', { query: 'の', limit: 51 }],
      ['limit が 0', { query: 'の', limit: 0 }],
      ['query が長すぎる', { query: 'あ'.repeat(201) }],
      ['query が空', { query: '' }],
      ['query が空白だけ', { query: '　 ' }],
    ])('範囲外の引数はエラーにする（%s）', async (_, args) => {
      const result = await call('search_utterances', args);
      expect(result.isError).toBe(true);
    });
  });

  describe('get_utterances', () => {
    it('範囲の発話と nextFrom を返す', async () => {
      const first = await call('get_utterances', {
        transcriptionId: h('checked-talk'),
        from: 0,
        count: 2,
      });
      expect(first.json.utterances.map((u) => u.index)).toEqual([0, 1]);
      expect(first.json.nextFrom).toBe(2);
      expect(first.json.total).toBe(5);

      const last = await call('get_utterances', {
        transcriptionId: h('checked-talk'),
        from: 4,
      });
      expect(last.json.utterances).toHaveLength(1);
      expect(last.json.nextFrom).toBeUndefined();
      expect(JSON.stringify(last.json)).not.toContain(HIDDEN_NAME);
    });

    it('範囲外の from・上限を超える count はエラーにする', async () => {
      for (const args of [
        { transcriptionId: h('checked-talk'), from: 5 },
        { transcriptionId: h('checked-talk'), from: -1 },
        { transcriptionId: h('checked-talk'), from: 0, count: 101 },
      ]) {
        expect((await call('get_utterances', args)).isError).toBe(true);
      }
    });

    it('長い発話は切り詰め、結果が大きすぎる分は nextFrom で続きを返す', async () => {
      const long = 'あ'.repeat(MAX_UTTERANCE_CHARS + 500);
      const t = makeTranscription(
        'long-talk',
        Array.from({ length: 100 }, (): [string, string] => [
          'speaker_0',
          long,
        ]),
      );
      await data.writeChecked(t);

      const result = await call('get_utterances', {
        transcriptionId: h('long-talk'),
        from: 0,
        count: 100,
      });
      expect(result.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      const { utterances, nextFrom } = result.json;
      expect(utterances[0].text).toHaveLength(MAX_UTTERANCE_CHARS);
      expect(utterances[0].truncated).toBe(true);
      expect(utterances.length).toBeLessThan(100);
      expect(nextFrom).toBe(utterances.length);
    });
  });

  describe('get_context', () => {
    it('前後の発話を返し、中心に印を付ける', async () => {
      const { json } = await call('get_context', {
        transcriptionId: h('checked-talk'),
        index: 1,
        before: 1,
        after: 10,
      });
      expect(json.utterances.map((u) => u.index)).toEqual([0, 1, 2, 3, 4]);
      expect(json.utterances[1].center).toBe(true);
      expect(json.utterances[0].center).toBeUndefined();
      expect(json.utterances[2].text).toBe('連絡先は [電話番号] です');
    });

    it('範囲外の index・上限を超える前後の数はエラーにする', async () => {
      for (const args of [
        { transcriptionId: h('checked-talk'), index: 5 },
        { transcriptionId: h('checked-talk'), index: 0, before: 11 },
        { transcriptionId: h('checked-talk'), index: 0, after: 11 },
      ]) {
        expect((await call('get_context', args)).isError).toBe(true);
      }
    });
  });

  describe('get_keywords', () => {
    const terms: [string, string][][] = [
      [
        [HIDDEN_NAME, HIDDEN_NAME],
        ['型チェック', '型チェック'],
      ],
      [['型チェック', '型チェック']],
      [['連絡先', '連絡先']],
      [['設定', '設定']],
      [['架空', '架空']],
    ];

    it('抽出していなければ not_extracted で空を返す', async () => {
      const { json } = await call('get_keywords', {
        transcriptionId: h('checked-talk'),
      });
      expect(json).toEqual({
        transcriptionId: h('checked-talk'),
        status: 'not_extracted',
        keywords: [],
      });
    });

    it('抽出の後に発話が変わっていれば stale で空を返す', async () => {
      await data.writeGinzaCache(checked, terms, 'old-hash');
      const { json } = await call('get_keywords', {
        transcriptionId: h('checked-talk'),
      });
      expect(json.status).toBe('stale');
      expect(json.keywords).toEqual([]);
    });

    it('回数の多い順に返し、伏せた文字列（とその一部）を含むキーワードは除く', async () => {
      await data.writeGinzaCache(checked, terms);
      const { json } = await call('get_keywords', {
        transcriptionId: h('checked-talk'),
      });
      expect(json.status).toBe('ok');
      const texts = json.keywords.map((k) => k.text);
      expect(texts[0]).toBe('型チェック');
      expect(texts).toContain('TypeScript');
      expect(texts).not.toContain(HIDDEN_NAME);
      expect(texts).not.toContain('架空');
    });

    it('話者で絞り込める', async () => {
      await data.writeGinzaCache(checked, terms);
      const { json } = await call('get_keywords', {
        transcriptionId: h('checked-talk'),
        speakerId: 'speaker_1',
      });
      expect(json.speakerName).toBe('Bさん');
      expect(json.keywords.map((k) => k.text)).not.toContain('連絡先');
      const unknown = await call('get_keywords', {
        transcriptionId: h('checked-talk'),
        speakerId: 'speaker_9',
      });
      expect(unknown.isError).toBe(true);
    });
  });

  describe('不正な id', () => {
    it.each([
      ['../x'],
      ['..'],
      ['.'],
      ['a\\b'],
      ['a\0b'],
      ['x'.repeat(256)],
      ['missing'],
    ])('%s はエラーにする', async (id) => {
      const result = await call('get_utterances', {
        transcriptionId: id,
        from: 0,
      });
      expect(result.isError).toBe(true);
    });

    it('シンボリックリンクのフォルダは使わない', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-outside-'));
      try {
        const t = makeTranscription('linked-talk', [['speaker_0', '外の会話']]);
        await fs.writeFile(
          path.join(outside, 'transcription.json'),
          JSON.stringify(t),
        );
        await fs.symlink(
          outside,
          path.join(data.dir, 'transcriptions', 'linked-talk'),
        );
        await data.writeScan('linked-talk', []);

        const result = await call('get_utterances', {
          transcriptionId: h('linked-talk'),
          from: 0,
        });
        expect(result.isError).toBe(true);
        expect(result.text).toContain('見つかりません');
        const list = await call('list_transcriptions');
        expect(JSON.stringify(list.json)).not.toContain(h('linked-talk'));
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });

    it('日本語や空白を含む id も使える', async () => {
      const t = makeTranscription('雑談 第1回', [['speaker_0', 'こんにちは']]);
      await data.writeChecked(t);
      const result = await call('get_utterances', {
        transcriptionId: h('雑談 第1回'),
        from: 0,
      });
      expect(result.isError).toBe(false);
      expect(result.json.utterances[0].text).toBe('こんにちは');
    });
  });

  describe('ファイル名・連絡先を返さない', () => {
    it('フォルダ名（音声ファイル名）に入った名前を、ID・一覧・発話の結果に出さない', async () => {
      const lines: [string, string][] = [
        ['speaker_0', '架空の打ち合わせの話です'],
      ];
      // チェック済みの会話（名前はファイル名にだけあり、個人情報チェックでは検出されていない）
      await data.writeChecked(
        makeTranscription(`${HIDDEN_NAME}さん打ち合わせ`, lines, {
          audioFileName: `${HIDDEN_NAME}さん打ち合わせ.mp3`,
        }),
      );
      // チェックしていない会話
      await data.writeTranscription(
        makeTranscription(`${HIDDEN_NAME}さん打ち合わせ2`, lines),
      );

      const list = await call('list_transcriptions');
      expect(list.text).not.toContain(HIDDEN_NAME);
      expect(list.text).not.toContain('打ち合わせ');
      for (const t of list.json.transcriptions) {
        expect(t.id).toMatch(/^t_[0-9a-f]{24}$/);
        expect(t).not.toHaveProperty('audioFileName');
      }

      const id = h(`${HIDDEN_NAME}さん打ち合わせ`);
      const search = await call('search_utterances', {
        query: '架空の打ち合わせ',
      });
      expect(search.json.utterances[0].transcriptionId).toBe(id);
      expect(search.text).not.toContain(HIDDEN_NAME);
      const page = await call('get_utterances', {
        transcriptionId: id,
        from: 0,
      });
      expect(page.text).not.toContain(HIDDEN_NAME);
      const context = await call('get_context', {
        transcriptionId: id,
        index: 0,
      });
      expect(context.text).not.toContain(HIDDEN_NAME);
    });

    it('フォルダ名をそのまま id に渡しても読めない', async () => {
      const result = await call('get_utterances', {
        transcriptionId: 'checked-talk',
        from: 0,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('transcriptionId が不正です');
    });

    it('個人情報チェックで見つからなかった連絡先も伏せ、その連絡先では検索できない', async () => {
      await data.writeChecked(
        makeTranscription('contact-talk', [
          ['speaker_0', 'メールは taro@example.com、電話は 080-1111-2222 です'],
        ]),
      );
      const result = await call('get_utterances', {
        transcriptionId: h('contact-talk'),
        from: 0,
      });
      expect(result.json.utterances[0].text).toBe(
        'メールは [メールアドレス]、電話は [電話番号] です',
      );
      for (const query of ['taro@example.com', '080-1111-2222', 'example']) {
        const search = await call('search_utterances', { query });
        expect(search.json.total).toBe(0);
      }
    });
  });

  describe('不完全な文字起こし', () => {
    it.each([
      ['createdAt が文字列ではない', { createdAt: 20260101 }],
      ['fullText がない', { fullText: undefined }],
      ['words がない', { words: undefined }],
      ['話者名が文字列ではない', { speakers: [{ id: 'speaker_0', name: 1 }] }],
      [
        '発話の words がない',
        {
          utterances: [
            {
              speakerId: 'speaker_0',
              speakerName: 'Aさん',
              start: 0,
              end: 1,
              text: 'x',
            },
          ],
        },
      ],
    ])(
      'その会話だけを error にし、ほかの会話は返す（%s）',
      async (_, broken) => {
        const t = {
          ...makeTranscription('broken-talk', [['speaker_0', 'x']]),
          ...broken,
        };
        await data.writeChecked(t as Transcription, FINDINGS);
        const { json, isError } = await call('list_transcriptions');
        expect(isError).toBe(false);
        const byId = Object.fromEntries(
          json.transcriptions.map((x) => [x.id, x]),
        );
        expect(byId[h('broken-talk')].privacy).toBe('error');
        expect(byId[h('checked-talk')].privacy).toBe('checked');
        const search = await call('search_utterances', { query: '型チェック' });
        expect(search.json.total).toBe(2);
      },
    );
  });

  describe('get_context の大きさ', () => {
    it('結果が大きすぎる場合は、中心を残して遠い発話から除く', async () => {
      // JSON にすると文字数が増える文字（改行）で、1発話を大きくする
      const long = '\n'.repeat(MAX_UTTERANCE_CHARS);
      await data.writeChecked(
        makeTranscription(
          'wide-talk',
          Array.from({ length: 21 }, (): [string, string] => [
            'speaker_0',
            long,
          ]),
        ),
      );
      const result = await call('get_context', {
        transcriptionId: h('wide-talk'),
        index: 10,
        before: 10,
        after: 10,
      });
      expect(result.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      const { utterances } = result.json;
      expect(utterances.length).toBeLessThan(21);
      expect(utterances.some((u) => u.center && u.index === 10)).toBe(true);
      expect((result.json as unknown as { truncated: boolean }).truncated).toBe(
        true,
      );
    });
  });

  describe('監査ログ', () => {
    it('呼び出しごとに記録し、発話の本文は残さない', async () => {
      await call('search_utterances', { query: '型チェック' });
      await call('get_utterances', {
        transcriptionId: h('checked-talk'),
        from: 0,
      });
      await call('get_context', { transcriptionId: '../x', index: 0 });

      const log = await data.readAuditLog();
      const records = log
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toEqual([
        {
          at: '2026-10-20T00:00:00.000Z',
          tool: 'search_utterances',
          args: { query: '型チェック' },
          sources: ['checked-talk'],
          returned: 2,
          outcome: 'ok',
        },
        {
          at: '2026-10-20T00:00:00.000Z',
          tool: 'get_utterances',
          args: { transcriptionId: h('checked-talk'), from: 0 },
          sources: ['checked-talk'],
          returned: 5,
          outcome: 'ok',
        },
        {
          at: '2026-10-20T00:00:00.000Z',
          tool: 'get_context',
          args: { transcriptionId: '../x', index: 0 },
          returned: 0,
          outcome: 'rejected',
          reason:
            'transcriptionId が不正です（list_transcriptions の id を渡してください）',
        },
      ]);
      expect(await fs.readdir(path.join(data.dir, 'mcp-audit-logs'))).toEqual([
        '2026-10.jsonl',
      ]);
      for (const u of checked.utterances) expect(log).not.toContain(u.text);
      expect(log).not.toContain('今日は');
    });

    it('検索語・話者名の中の個人情報は伏せて記録する', async () => {
      await call('search_utterances', {
        query: `${HIDDEN_NAME} 080-1111-2222 test@example.com`,
        speakerName: HIDDEN_NAME,
      });
      const log = await data.readAuditLog();
      expect(log).not.toContain(HIDDEN_NAME);
      expect(log).not.toContain('080-1111-2222');
      expect(log).not.toContain('test@example.com');
      const record = JSON.parse(log.trim()) as { args: Record<string, string> };
      expect(record.args).toEqual({
        query: '[氏名] [電話番号] [メールアドレス]',
        speakerName: '[氏名]',
      });
    });

    it('記録に失敗しても結果は返す', async () => {
      // 監査ログのフォルダの場所にファイルを置いて、書き込めなくする
      await fs.writeFile(path.join(data.dir, 'mcp-audit-logs'), '');
      const result = await call('list_transcriptions');
      expect(result.isError).toBe(false);
      expect(logs.join('\n')).toContain('記録できませんでした');
    });
  });
});
