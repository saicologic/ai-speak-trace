import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { RawJudgement, ResearchClaudeService } from './research-claude.service';
import { ResearchJobStore } from './research-job.store';
import { GuardrailService } from '../privacy/guardrail.service';
import { PrivacyService } from '../privacy/privacy.service';
import {
  evaluate,
  normalizeTitle,
  ResearchService,
  resumeStage,
  sendableWords,
} from './research.service';
import { Transcription } from '../transcription/types/transcription.types';
import { ReportSegment, ResearchJob } from './types/research.types';

const cite = (official?: boolean) => ({
  sourceKind:
    official === undefined ? ('conversation' as const) : ('web' as const),
  sourceId: 'x',
  title: 'x',
  citedText: '根拠',
  ...(official !== undefined && { official }),
});

const ethicsOk = {
  no_sensitive_inference: { passed: true, detail: 'なし' },
  no_individual_judgement: { passed: true, detail: 'なし' },
};

describe('evaluate', () => {
  const report: ReportSegment[] = [
    { text: '## 見出し', citations: [] },
    { text: '裏付けのある主張。', citations: [cite(), cite(true)] },
    { text: '一部だけ裏付けのある主張。', citations: [cite(false)] },
    { text: '根拠と食い違う主張。', citations: [cite(true)] },
    { text: '根拠のない主張。', citations: [] },
  ];
  const judgement: RawJudgement = {
    claims: [
      { index: 0, factual: false, verdict: 'not_applicable', reason: '見出し' },
      { index: 1, factual: true, verdict: 'supported', reason: 'OK' },
      { index: 2, factual: true, verdict: 'partial', reason: '一部' },
      { index: 3, factual: true, verdict: 'unsupported', reason: '食い違い' },
      { index: 4, factual: true, verdict: 'unsupported', reason: '根拠なし' },
    ],
    relevance: [{ keyword: 'ハーネス', answered: true, reason: '答えている' }],
    ethics: ethicsOk,
  };

  it('裏付けのない主張と根拠のない主張を除き、評価を計算する', () => {
    const { finalReport, evaluation } = evaluate(report, judgement, ['見出し']);
    expect(finalReport.map((s) => s.text)).toEqual([
      '## 見出し',
      '裏付けのある主張。',
      '一部だけ裏付けのある主張。',
    ]);
    expect(evaluation.factualClaims).toBe(4);
    expect(evaluation.citationCoverage).toBe(3 / 4);
    expect(evaluation.supportedRate).toBe(1 / 3);
    expect(evaluation.removedClaims.map((c) => c.reason)).toEqual([
      '食い違い',
      '根拠なし',
    ]);
    // 残った Web の根拠は公式1件・公式以外1件
    expect(evaluation.officialSourceRate).toBe(0.5);
    expect(evaluation.ethics.every((e) => e.passed)).toBe(true);
  });

  it('「不足:」「推測:」の注記と関連するキーワードの列挙は、事実の主張と判定されても除かない', () => {
    const notes: ReportSegment[] = [
      { text: '- 不足: 公式情報には記載がない。\n', citations: [] },
      { text: '- **推測**：今後広がりそうだ。\n', citations: [] },
      { text: '**関連するキーワード**: Skills、MCP\n', citations: [] },
    ];
    const { finalReport, evaluation } = evaluate(
      notes,
      {
        ...judgement,
        claims: [
          { index: 0, factual: true, verdict: 'unsupported', reason: 'なし' },
          { index: 1, factual: true, verdict: 'unsupported', reason: 'なし' },
        ],
      },
      [],
    );
    expect(finalReport).toEqual(notes);
    expect(evaluation.factualClaims).toBe(0);
    expect(evaluation.removedClaims).toEqual([]);
  });

  it('判定が返らなかった文は、論点の見出しと項目名だけを残し、ほかは裏付けを確認できない主張として除く', () => {
    const { finalReport, evaluation } = evaluate(
      [
        { text: '## 見出し\n\n', citations: [] },
        { text: '**会話では**\n', citations: [] },
        { text: '判定なし・根拠あり。', citations: [cite()] },
        { text: '判定なし・根拠なし。', citations: [] },
        { text: '**売上が倍増した**\n', citations: [] },
        { text: '## 売上が倍増した\n', citations: [] },
      ],
      { claims: [], relevance: [], ethics: ethicsOk },
      ['見出し'],
    );
    expect(finalReport.map((s) => s.text)).toEqual([
      '## 見出し\n\n',
      '**会話では**\n',
    ]);
    expect(evaluation.factualClaims).toBe(4);
    expect(evaluation.removedClaims.map((c) => c.reason)).toEqual([
      '判定が返りませんでした',
      '判定が返りませんでした',
      '判定が返りませんでした',
      '判定が返りませんでした',
    ]);
    expect(evaluation.officialSourceRate).toBeNull();
  });

  it('除いた文に含まれる見出しは残す', () => {
    const { finalReport } = evaluate(
      [{ text: 'と述べた。\n\n**示唆**\n- 根拠のない示唆', citations: [] }],
      {
        claims: [
          { index: 0, factual: true, verdict: 'unsupported', reason: 'なし' },
        ],
        relevance: [],
        ethics: ethicsOk,
      },
      [],
    );
    expect(finalReport).toEqual([{ text: '\n\n**示唆**\n', citations: [] }]);
  });

  it('事実の主張に根拠がなければ、判定が supported でも除く', () => {
    const { finalReport, evaluation } = evaluate(
      [{ text: '根拠なしの断定。', citations: [] }],
      {
        claims: [
          { index: 0, factual: true, verdict: 'supported', reason: '一般知識' },
        ],
        relevance: [],
        ethics: ethicsOk,
      },
      [],
    );
    expect(finalReport).toEqual([]);
    expect(evaluation.citationCoverage).toBe(0);
    expect(evaluation.removedClaims).toHaveLength(1);
  });
});

describe('evaluate（Guardrails の根拠スコアあり）', () => {
  const en = (text: string) => ({ text, citations: [cite(true)] });
  const judge = (verdicts: ('supported' | 'unsupported')[]): RawJudgement => ({
    claims: verdicts.map((verdict, index) => ({
      index,
      factual: true,
      verdict,
      reason: verdict,
    })),
    relevance: [],
    ethics: ethicsOk,
  });

  it('両方が根拠と合わないと判定した主張だけ除き、判定が分かれた主張は要確認にする', () => {
    const report = [
      en('both ok'),
      en('both ng'),
      en('judge ng'),
      en('guard ng'),
    ];
    const { finalReport, evaluation } = evaluate(
      report,
      judge(['supported', 'unsupported', 'unsupported', 'supported']),
      [],
      new Map([
        [0, 0.95],
        [1, 0.1],
        [2, 0.9],
        [3, 0.5],
      ]),
    );
    expect(finalReport.map((s) => s.text)).toEqual([
      'both ok',
      'judge ng',
      'guard ng',
    ]);
    expect(evaluation.removedClaims.map((c) => c.groundingScore)).toEqual([
      0.1,
    ]);
    expect(evaluation.reviewClaims?.map((c) => c.claim)).toEqual([
      'judge ng',
      'guard ng',
    ]);
  });
});

describe('ResearchService', () => {
  const baseJob: ResearchJob = {
    id: 'job-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'awaiting_confirmation',
    transcriptionIds: ['t1'],
    transcriptionNames: { t1: 'a.mp3' },
    models: { analysis: 'model' },
  };

  const setup = (stored: ResearchJob | null) => {
    let current = stored;
    const jobStore = {
      findById: jest.fn(() => Promise.resolve(current)),
      save: jest.fn((job: ResearchJob) => {
        current = job;
        return Promise.resolve();
      }),
      findAllSummaries: jest.fn(() => Promise.resolve([])),
    };
    const transcriptionStore = {
      // 会話の読み込みで止めて、Claude を呼ばないようにする
      findById: jest.fn(() => new Promise(() => {})),
    };
    const service = new ResearchService(
      transcriptionStore as unknown as TranscriptionStoreService,
      jobStore as unknown as ResearchJobStore,
      {} as ResearchClaudeService,
      { isConfigured: () => false } as unknown as GuardrailService,
      {} as PrivacyService,
    );
    return {
      service,
      jobStore,
      remove: () => {
        current = null;
      },
    };
  };

  it('個人情報チェックをしていない会話は、調査を作る前に検出する', async () => {
    const raw = { id: 't1' };
    const transcriptionStore = {
      findById: jest.fn(() => Promise.resolve(raw)),
      // 検出の後の会話の読み込みで止めて、Claude を呼ばないようにする
      findForSending: jest.fn(() => new Promise(() => {})),
    };
    const privacy = {
      waitForScans: jest.fn(() => Promise.resolve()),
      getStatus: jest.fn(() =>
        Promise.resolve({ configured: true, scanning: false, scan: null }),
      ),
      scan: jest.fn(() => Promise.resolve({})),
    };
    const service = new ResearchService(
      transcriptionStore as unknown as TranscriptionStoreService,
      {} as ResearchJobStore,
      {} as ResearchClaudeService,
      { isConfigured: () => true } as unknown as GuardrailService,
      privacy as unknown as PrivacyService,
    );
    void service.start(['t1']);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(privacy.scan).toHaveBeenCalledWith(raw);
    expect(transcriptionStore.findForSending).toHaveBeenCalledWith('t1');
  });

  it('個人情報チェックに失敗した場合は、調査を作らずに拒否する', async () => {
    const jobStore = { save: jest.fn() };
    const service = new ResearchService(
      {
        findById: jest.fn(() => Promise.resolve({ id: 't1' })),
      } as unknown as TranscriptionStoreService,
      jobStore as unknown as ResearchJobStore,
      {} as ResearchClaudeService,
      { isConfigured: () => true } as unknown as GuardrailService,
      {
        waitForScans: jest.fn(() => Promise.resolve()),
        getStatus: jest.fn(() => Promise.resolve({ scan: null })),
        scan: jest.fn(() => Promise.reject(new Error('throttled'))),
      } as unknown as PrivacyService,
    );
    await expect(service.start(['t1'])).rejects.toThrow(
      '個人情報チェックに失敗したため、調査を始められません: throttled',
    );
    expect(jobStore.save).not.toHaveBeenCalled();
  });

  it('Guardrail ID が未設定なら、調査を作らずに拒否する', async () => {
    const { service, jobStore } = setup(null);
    await expect(service.start(['t1'])).rejects.toThrow(
      'Guardrail ID を設定してください',
    );
    expect(jobStore.save).not.toHaveBeenCalled();
  });

  it('タイトルを変更する（空のタイトルは拒否する）', async () => {
    const { service, jobStore } = setup(baseJob);
    await expect(service.updateTitle('job-1', '  ')).rejects.toThrow(
      'タイトルを入力してください',
    );
    const updated = await service.updateTitle('job-1', ' 新しい題名 ');
    expect(updated.title).toBe('新しい題名');
    expect(jobStore.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '新しい題名' }),
    );
  });

  it('調査の途中でタイトルを変更しても、その後の保存で元に戻らない', async () => {
    const { service, jobStore } = setup(baseJob);
    // 調査の処理が持っている古い内容（タイトルなし）
    const stale = { ...baseJob };
    await service.updateTitle('job-1', '利用者のタイトル');
    await (
      service as unknown as {
        update: (
          job: ResearchJob,
          changes: Partial<ResearchJob>,
        ) => Promise<ResearchJob>;
      }
    ).update(stale, { status: 'analyzing' });
    expect(jobStore.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'analyzing',
        title: '利用者のタイトル',
      }),
    );
  });

  it('同じ調査の確定を同時に2回受けた場合、2回目を拒否する', async () => {
    const { service, jobStore } = setup(baseJob);
    const results = await Promise.allSettled([
      service.confirm('job-1', [{ keyword: 'ハーネス', domains: [] }]),
      service.confirm('job-1', [{ keyword: 'ハーネス', domains: [] }]),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(
      jobStore.save.mock.calls.filter(([job]) => job.status === 'researching'),
    ).toHaveLength(1);
  });

  it('削除された調査ジョブは、失敗の記録でも保存し直さない', async () => {
    const { service, jobStore, remove } = setup(baseJob);
    remove();
    await (
      service as unknown as {
        fail: (job: ResearchJob, error: unknown) => Promise<void>;
      }
    ).fail(baseJob, new Error('失敗'));
    expect(jobStore.save).not.toHaveBeenCalled();
  });
});

/** Anthropic API のクレジット不足のエラー文 */
const CREDIT_ERROR =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

describe('resumeStage', () => {
  const failed: ResearchJob = {
    id: 'job-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'failed',
    error: CREDIT_ERROR,
    transcriptionIds: ['t1'],
    transcriptionNames: { t1: 'a.mp3' },
    models: { analysis: 'model' },
  };
  const proposal = { keywords: [], domains: [] };
  const confirmed = {
    keywords: ['ハーネス', 'MCP'],
    domains: [],
    targets: [
      { keyword: 'ハーネス', domains: [] },
      { keyword: 'MCP', domains: [] },
    ],
  };
  const source = {
    url: 'https://example.com/a',
    title: 'a',
    domain: 'example.com',
    official: false,
    excerpts: ['抜粋'],
  };

  it('保存した結果から、終わっていない最初の段階を返す', () => {
    expect(resumeStage(failed)).toEqual({ from: 'proposing' });
    expect(resumeStage({ ...failed, proposal, confirmed })).toEqual({
      from: 'researching',
    });
    expect(
      resumeStage({ ...failed, proposal, confirmed, webSources: [source] }),
    ).toEqual({ from: 'analyzing' });
    expect(
      resumeStage({
        ...failed,
        proposal,
        confirmed,
        webSources: [source],
        report: [{ text: '本文', citations: [] }],
      }),
    ).toEqual({ from: 'evaluating' });
  });

  it('Web調査で待てば直る失敗があったキーワードだけを、調べ直すキーワードにする', () => {
    expect(
      resumeStage({
        ...failed,
        proposal,
        confirmed,
        webSources: [source],
        webResearchFailures: [
          { keyword: 'ハーネス', error: CREDIT_ERROR },
          { keyword: 'MCP', error: '検索結果を読み取れませんでした' },
        ],
      }),
    ).toEqual({ from: 'researching', retryKeywords: ['ハーネス'] });
  });

  it('失敗していない調査と、再開しても同じ理由で失敗する調査は再開しない', () => {
    expect(resumeStage({ ...failed, status: 'completed' })).toBeNull();
    expect(
      resumeStage({
        ...failed,
        error:
          '送る内容に指示の書き換え（プロンプト攻撃）の疑いがあるため、Claude に送りませんでした（PROMPT_ATTACK）',
      }),
    ).toBeNull();
  });
});

describe('ResearchService（失敗した調査の再開）', () => {
  const transcription = {
    id: 't1',
    audioFileName: 'a.mp3',
    utterances: [{ speakerName: 'Aさん', start: 0, text: 'ハーネスとMCPの話' }],
  } as unknown as Transcription;
  const source = (url: string) => ({
    url,
    title: url,
    domain: 'example.com',
    official: false,
    excerpts: ['抜粋'],
  });
  const confirmedJob: ResearchJob = {
    id: 'job-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'failed',
    error: CREDIT_ERROR,
    transcriptionIds: ['t1'],
    transcriptionNames: { t1: 'a.mp3' },
    models: { analysis: 'model' },
    proposal: { keywords: [], domains: [] },
    confirmed: {
      keywords: ['ハーネス', 'MCP'],
      domains: [],
      targets: [
        { keyword: 'ハーネス', domains: [] },
        { keyword: 'MCP', domains: [] },
      ],
    },
  };

  const setup = (stored: ResearchJob) => {
    let current: ResearchJob | null = stored;
    const jobStore = {
      findById: jest.fn(() => Promise.resolve(current)),
      save: jest.fn((job: ResearchJob) => {
        current = job;
        return Promise.resolve();
      }),
      findAllSummaries: jest.fn(() =>
        Promise.resolve(
          current ? [{ id: current.id, status: current.status }] : [],
        ),
      ),
    };
    const claude = {
      researchWeb: jest.fn(),
      analyze: jest.fn(() =>
        Promise.resolve([{ text: '本文', citations: [] }]),
      ),
      judge: jest.fn(() =>
        Promise.resolve({ claims: [], relevance: [], ethics: ethicsOk }),
      ),
    };
    const service = new ResearchService(
      {
        findForSending: jest.fn(() => Promise.resolve(transcription)),
      } as unknown as TranscriptionStoreService,
      jobStore as unknown as ResearchJobStore,
      claude as unknown as ResearchClaudeService,
      {
        isConfigured: () => true,
        guardrailId: 'g1',
        inspect: jest.fn(() =>
          Promise.resolve({ pii: [], words: [], content: [] }),
        ),
        checkGrounding: jest.fn(() => Promise.resolve(null)),
      } as unknown as GuardrailService,
      {
        waitForScans: jest.fn(() => Promise.resolve()),
        getStatus: jest.fn(() =>
          Promise.resolve({
            configured: true,
            scanning: false,
            scan: { findings: [] },
          }),
        ),
      } as unknown as PrivacyService,
    );
    /** バックグラウンドの処理が、指定した状態になるまで待つ */
    const waitFor = async (status: ResearchJob['status']) => {
      for (let i = 0; i < 50 && current?.status !== status; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return current!;
    };
    return { service, jobStore, claude, waitFor };
  };

  it('統合分析で失敗した調査は、保存した情報源を使って④から再開する（Web調査をやり直さない）', async () => {
    const webSources = [source('https://example.com/a')];
    const { service, claude, waitFor } = setup({
      ...confirmedJob,
      webSources,
    });

    const resumed = await service.resume('job-1');
    expect(resumed.status).toBe('analyzing');
    expect(resumed.error).toBeUndefined();

    const done = await waitFor('completed');
    expect(done.status).toBe('completed');
    expect(claude.researchWeb).not.toHaveBeenCalled();
    expect(claude.analyze).toHaveBeenCalledWith(expect.any(Array), webSources, [
      'ハーネス',
      'MCP',
    ]);
  });

  it('Web調査で待てば直る失敗があれば④に進まずに止め、再開すると失敗したキーワードだけを調べ直す', async () => {
    const { service, claude, waitFor } = setup({
      ...confirmedJob,
      status: 'awaiting_confirmation',
      error: undefined,
    });
    claude.researchWeb.mockResolvedValueOnce({
      sources: [source('https://example.com/a')],
      failures: [{ keyword: 'MCP', error: CREDIT_ERROR }],
    });
    await service.confirm('job-1', confirmedJob.confirmed!.targets!);
    const failed = await waitFor('failed');
    expect(claude.analyze).not.toHaveBeenCalled();
    expect(failed.failedStage).toBe('researching');
    expect(failed.errorInfo?.kind).toBe('credit');
    // 成功したキーワードの情報源は保存しておく
    expect(failed.webSources).toHaveLength(1);
    expect((await service.findById('job-1')).resume).toEqual({
      from: 'researching',
      retryKeywords: ['MCP'],
    });

    claude.researchWeb.mockResolvedValueOnce({
      sources: [source('https://example.com/b')],
      failures: [],
    });
    await service.resume('job-1');
    const done = await waitFor('completed');
    expect(claude.researchWeb).toHaveBeenLastCalledWith([
      { keyword: 'MCP', domains: [] },
    ]);
    expect(done.webSources?.map((s) => s.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(done.webResearchFailures).toBeUndefined();
  });

  it('待っても直らない Web調査の失敗は、これまでどおりほかのキーワードの結果で続ける', async () => {
    const { service, claude, waitFor } = setup({
      ...confirmedJob,
      status: 'awaiting_confirmation',
      error: undefined,
    });
    claude.researchWeb.mockResolvedValueOnce({
      sources: [source('https://example.com/a')],
      failures: [{ keyword: 'MCP', error: '検索結果を読み取れませんでした' }],
    });
    await service.confirm('job-1', confirmedJob.confirmed!.targets!);
    const done = await waitFor('completed');
    expect(done.webResearchFailures).toEqual([
      { keyword: 'MCP', error: '検索結果を読み取れませんでした' },
    ]);
  });

  it('アプリの再起動で中断した調査は、中断した段階から再開できる', async () => {
    const { service, jobStore } = setup({
      ...confirmedJob,
      status: 'analyzing',
      error: undefined,
      webSources: [source('https://example.com/a')],
    });
    await service.onModuleInit();
    const job = await service.findById('job-1');
    expect(job.status).toBe('failed');
    expect(job.failedStage).toBe('analyzing');
    expect(job.errorInfo?.kind).toBe('interrupted');
    expect(job.resume).toEqual({ from: 'analyzing' });
    // 再開する段階は保存しない
    expect(jobStore.save.mock.calls.at(-1)![0].resume).toBeUndefined();
  });

  it('以前の失敗した調査にも、エラー文から失敗の説明を付ける', async () => {
    const { service } = setup(confirmedJob);
    const job = await service.findById('job-1');
    expect(job.errorInfo?.kind).toBe('credit');
    expect(job.resume).toEqual({ from: 'researching' });
  });

  it('失敗していない調査と、再開しても同じ理由で失敗する調査は、再開を拒否する', async () => {
    await expect(
      setup({ ...confirmedJob, status: 'completed' }).service.resume('job-1'),
    ).rejects.toThrow('再開できる状態ではありません');
    await expect(
      setup({
        ...confirmedJob,
        error:
          'Claude の応答に不適切な表現（侮辱）が検出されたため、応答を使いませんでした',
      }).service.resume('job-1'),
    ).rejects.toThrow('新しく調査を始めてください');
  });

  it('同じ調査の再開を同時に2回受けた場合、2回目を拒否する', async () => {
    const { service } = setup({
      ...confirmedJob,
      webSources: [source('https://example.com/a')],
    });
    const results = await Promise.allSettled([
      service.resume('job-1'),
      service.resume('job-1'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  });
});

describe('sendableWords', () => {
  it('伏せた後の会話に出てこない頻出語を除き、回数を数え直す', () => {
    const masked = {
      utterances: [
        { text: '[氏名]さんと Claude Code の話をした' },
        { text: 'Claude Code は便利' },
      ],
    } as unknown as Transcription;
    expect(
      sendableWords(
        [masked],
        [
          { word: '金井', count: 4 },
          { word: 'Claude Code', count: 5 },
        ],
      ),
    ).toEqual([{ word: 'Claude Code', count: 2 }]);
  });
});

describe('ResearchService（送る前の確認）', () => {
  it('個人情報チェックの結果と、提案から外したキーワード・引用・頻出語を記録する', async () => {
    const transcription = {
      id: 't1',
      audioFileName: 'a.mp3',
      utterances: [
        {
          speakerName: 'Aさん',
          start: 0,
          text: '[氏名]さんとハーネスの話をした',
        },
      ],
    } as unknown as Transcription;
    let saved: ResearchJob | null = null;
    const jobStore = {
      findById: jest.fn(() => Promise.resolve(saved)),
      save: jest.fn((job: ResearchJob) => {
        saved = job;
        return Promise.resolve();
      }),
    };
    const claude = {
      proposeKeywords: jest.fn(() =>
        Promise.resolve({
          title: '  ハーネスの\n調査  ',
          keywords: [
            {
              keyword: 'ハーネス',
              reason: '理由',
              quotes: ['ハーネスの話をした', '作り話の引用'],
              domains: [],
            },
            {
              keyword: '会話にない語',
              reason: '理由',
              quotes: [],
              domains: [],
            },
          ],
        }),
      ),
    };
    const privacy = {
      waitForScans: jest.fn(() => Promise.resolve()),
      getStatus: jest.fn(() =>
        Promise.resolve({
          configured: true,
          scanning: false,
          scan: {
            findings: [
              {
                mask: true,
                needsReview: false,
                count: 3,
                label: 'メールアドレス',
                text: 'x@example.com',
              },
              {
                mask: false,
                needsReview: true,
                count: 1,
                label: '氏名',
                text: '山田',
              },
              {
                mask: false,
                needsReview: false,
                count: 5,
                label: '氏名',
                text: '佐藤',
              },
            ],
          },
        }),
      ),
    };
    const service = new ResearchService(
      {
        findForSending: jest.fn(() => Promise.resolve(transcription)),
      } as unknown as TranscriptionStoreService,
      jobStore as unknown as ResearchJobStore,
      claude as unknown as ResearchClaudeService,
      { isConfigured: () => true } as unknown as GuardrailService,
      privacy as unknown as PrivacyService,
    );

    await service.start(
      ['t1'],
      [
        { word: 'ハーネス', count: 1 },
        { word: '金井', count: 4 },
      ],
    );
    // 提案はバックグラウンドで進むため、保存されるまで待つ
    for (let i = 0; i < 10 && saved?.status !== 'awaiting_confirmation'; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // タイトルは空白と改行を整えて保存する
    expect(saved!.title).toBe('ハーネスの 調査');
    expect(saved!.preSendChecks).toEqual({
      privacyConfigured: true,
      privacy: [
        {
          transcriptionId: 't1',
          scanned: true,
          maskedKinds: 1,
          maskedCount: 3,
          needsReview: 1,
          // 調査を始めた時点で、伏せたものと、要確認のまま伏せずに送ったものを記録する
          masked: [
            { label: 'メールアドレス', text: 'x@example.com', count: 3 },
          ],
          unmasked: [{ label: '氏名', text: '山田', count: 1 }],
        },
      ],
      droppedFrequentWords: 1,
      droppedKeywords: ['会話にない語'],
      droppedQuotes: 1,
    });
  });
});

describe('evaluate の除いた文', () => {
  it('除いた文に、論点と、根拠が付いていなかったかを記録する', () => {
    const report: ReportSegment[] = [
      {
        text: '## ハーネス\n\n**一言でいうと**: 根拠のない定義です。',
        citations: [],
      },
      {
        text: '合わない根拠の文です。',
        citations: [
          {
            sourceKind: 'web',
            sourceId: 'https://a.com',
            title: 'a',
            citedText: 'x',
          },
        ] as ReportSegment['citations'],
      },
    ];
    const { evaluation } = evaluate(
      report,
      {
        claims: [
          { index: 0, factual: true, verdict: 'unsupported', reason: 'r' },
          { index: 1, factual: true, verdict: 'unsupported', reason: 'r' },
        ],
        relevance: [],
        ethics: {
          no_sensitive_inference: { passed: true, detail: '' },
          no_individual_judgement: { passed: true, detail: '' },
        },
      } as unknown as RawJudgement,
      ['ハーネス'],
    );
    expect(
      evaluation.removedClaims.map((c) => [c.topic, c.missingCitation]),
    ).toEqual([
      ['ハーネス', true],
      ['ハーネス', false],
    ]);
  });
});

describe('evaluate の relevance', () => {
  it('確定したキーワードの判定だけを使う（関連するキーワードの判定は捨てる）', () => {
    const report: ReportSegment[] = [{ text: '## ハーネス\n', citations: [] }];
    const { evaluation } = evaluate(
      report,
      {
        claims: [],
        relevance: [
          { keyword: 'ハーネス', answered: true, reason: '説明がある' },
          { keyword: 'MCP', answered: false, reason: '関連語' },
        ],
        ethics: {
          no_sensitive_inference: { passed: true, detail: '' },
          no_individual_judgement: { passed: true, detail: '' },
        },
      } as unknown as RawJudgement,
      ['ハーネス'],
    );
    expect(evaluation.relevance.map((r) => r.keyword)).toEqual(['ハーネス']);
  });
});

describe('normalizeTitle', () => {
  it('前後の空白と改行を除き、60文字で切り詰める', () => {
    expect(normalizeTitle('  AI\nエンジニアリング  ')).toBe(
      'AI エンジニアリング',
    );
    expect(normalizeTitle('あ'.repeat(80))).toHaveLength(60);
    expect(normalizeTitle(undefined)).toBe('');
  });
});
