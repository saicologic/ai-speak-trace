import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { RawJudgement, ResearchClaudeService } from './research-claude.service';
import { ResearchJobStore } from './research-job.store';
import { evaluate, ResearchService } from './research.service';
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
    const { finalReport, evaluation } = evaluate(report, judgement);
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

  it('「不足:」「推測:」の注記は、事実の主張と判定されても除かない', () => {
    const notes: ReportSegment[] = [
      { text: '- 不足: 公式情報には記載がない。\n', citations: [] },
      { text: '- **推測**：今後広がりそうだ。\n', citations: [] },
    ];
    const { finalReport, evaluation } = evaluate(notes, {
      ...judgement,
      claims: [
        { index: 0, factual: true, verdict: 'unsupported', reason: 'なし' },
        { index: 1, factual: true, verdict: 'unsupported', reason: 'なし' },
      ],
    });
    expect(finalReport).toEqual(notes);
    expect(evaluation.factualClaims).toBe(0);
    expect(evaluation.removedClaims).toEqual([]);
  });

  it('判定が返らなかった文は、見出しだけを残し、ほかは裏付けを確認できない主張として除く', () => {
    const { finalReport, evaluation } = evaluate(
      [
        { text: '## 見出し\n\n', citations: [] },
        { text: '判定なし・根拠あり。', citations: [cite()] },
        { text: '判定なし・根拠なし。', citations: [] },
      ],
      { claims: [], relevance: [], ethics: ethicsOk },
    );
    expect(finalReport.map((s) => s.text)).toEqual(['## 見出し\n\n']);
    expect(evaluation.factualClaims).toBe(2);
    expect(evaluation.removedClaims.map((c) => c.reason)).toEqual([
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
    );
    expect(finalReport).toEqual([]);
    expect(evaluation.citationCoverage).toBe(0);
    expect(evaluation.removedClaims).toHaveLength(1);
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
    );
    return {
      service,
      jobStore,
      remove: () => {
        current = null;
      },
    };
  };

  it('同じ調査の確定を同時に2回受けた場合、2回目を拒否する', async () => {
    const { service, jobStore } = setup(baseJob);
    const results = await Promise.allSettled([
      service.confirm('job-1', ['ハーネス'], []),
      service.confirm('job-1', ['ハーネス'], []),
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
