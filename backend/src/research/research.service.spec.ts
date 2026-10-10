import { RawJudgement } from './research-claude.service';
import { evaluate } from './research.service';
import { ReportSegment } from './types/research.types';

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

  it('判定が返らなかった文は、根拠があれば事実の主張、なければ見出しなどとして扱う', () => {
    const { finalReport, evaluation } = evaluate(
      [
        { text: '判定なし・根拠あり。', citations: [cite()] },
        { text: '判定なし・根拠なし。', citations: [] },
      ],
      { claims: [], relevance: [], ethics: ethicsOk },
    );
    expect(finalReport.map((s) => s.text)).toEqual([
      '判定なし・根拠あり。',
      '判定なし・根拠なし。',
    ]);
    expect(evaluation.factualClaims).toBe(1);
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
