import {
  extractEnglish,
  groundingTarget,
  isEnglishText,
  toOutputChecks,
} from './research-guardrails';

describe('isEnglishText', () => {
  it('英語の文は true、日本語の文は false', () => {
    expect(
      isEnglishText('Claude Code uses a harness to manage long-running tasks.'),
    ).toBe(true);
    expect(
      isEnglishText('Claude Code はハーネスで長い作業を管理します。'),
    ).toBe(false);
    expect(isEnglishText('OK')).toBe(false);
  });
});

describe('extractEnglish', () => {
  it('日本語に空白なしで混ざった英単語も1行ずつ取り出す', () => {
    expect(
      extractEnglish('この移行はfuckingひどかった。Claude Codeを使う'),
    ).toBe('fucking\nClaude Code');
  });
});

describe('groundingTarget', () => {
  const web = (citedText: string) => ({
    sourceKind: 'web' as const,
    sourceId: 'https://example.com',
    title: 't',
    citedText,
    official: true,
  });

  it('Web の根拠が付いた英語の文だけを対象にする', () => {
    const claim = 'The harness manages context for long-running agents.';
    expect(
      groundingTarget({ text: claim, citations: [web('a'), web('b')] }),
    ).toEqual({ source: 'a\n\nb', query: claim, claim });
    expect(groundingTarget({ text: claim, citations: [] })).toBeNull();
    expect(
      groundingTarget({
        text: 'ハーネスは文脈を管理します。',
        citations: [web('a')],
      }),
    ).toBeNull();
  });
});

describe('toOutputChecks', () => {
  it('連絡先は不合格、氏名などの候補は判定に使わない', () => {
    const [pii, content, words] = toOutputChecks(
      {
        pii: [
          { type: 'NAME', match: 'Claude' },
          { type: 'PHONE', match: '090-1234-5678' },
        ],
        words: [],
        content: [{ type: 'INSULTS', confidence: 'LOW' }],
      },
      ['damn'],
    );
    expect(pii.passed).toBe(false);
    expect(pii.detail).toContain('電話番号');
    expect(pii.detail).toContain('候補 1件');
    expect(content.passed).toBe(true);
    expect(words).toMatchObject({ passed: false, detail: '検出: damn' });
  });
});
