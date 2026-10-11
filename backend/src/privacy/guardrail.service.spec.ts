import { ConfigService } from '@nestjs/config';
import {
  GuardrailService,
  mergeAssessment,
  splitText,
  GuardrailFindings,
} from './guardrail.service';

describe('splitText', () => {
  it('行の区切りを優先して、指定した文字数以下に分ける', () => {
    expect(splitText('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc']);
  });

  it('1行が長すぎる場合は文字数で切る', () => {
    expect(splitText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
  });

  it('空のテキストは送らない', () => {
    expect(splitText('', 10)).toEqual([]);
  });
});

describe('mergeAssessment', () => {
  it('ユーザー名と国名だけの住所は、個人情報の検出から除く', () => {
    const findings: GuardrailFindings = { pii: [], words: [], content: [] };
    mergeAssessment(findings, {
      sensitiveInformationPolicy: {
        piiEntities: [
          {
            type: 'USERNAME',
            match: 'ChatGPT',
            action: 'NONE',
            detected: true,
          },
          { type: 'ADDRESS', match: '日本', action: 'NONE', detected: true },
          {
            type: 'ADDRESS',
            match: '東京都千代田区1-1',
            action: 'NONE',
            detected: true,
          },
          { type: 'NAME', match: '山田太郎', action: 'NONE', detected: true },
        ],
      },
    });
    expect(findings.pii).toEqual([
      { type: 'ADDRESS', match: '東京都千代田区1-1' },
      { type: 'NAME', match: '山田太郎' },
    ]);
  });

  it('個人情報・独自の正規表現・単語・コンテンツの検出を集める', () => {
    const findings: GuardrailFindings = { pii: [], words: [], content: [] };
    mergeAssessment(findings, {
      sensitiveInformationPolicy: {
        piiEntities: [
          { type: 'NAME', match: '山田太郎', action: 'NONE', detected: true },
          {
            type: 'EMAIL',
            match: 'x@example.com',
            action: 'NONE',
            detected: false,
          },
        ],
        regexes: [
          {
            name: 'JP_MY_NUMBER',
            match: '123456789012',
            action: 'NONE',
            detected: true,
          },
        ],
      },
      wordPolicy: {
        customWords: [],
        managedWordLists: [
          { type: 'PROFANITY', match: 'damn', action: 'NONE', detected: true },
        ],
      },
      contentPolicy: {
        filters: [
          {
            type: 'INSULTS',
            confidence: 'HIGH',
            action: 'NONE',
            detected: true,
          },
          { type: 'HATE', confidence: 'NONE', action: 'NONE', detected: false },
        ],
      },
    });
    expect(findings).toEqual({
      pii: [
        { type: 'NAME', match: '山田太郎' },
        { type: 'JP_MY_NUMBER', match: '123456789012' },
      ],
      words: ['damn'],
      content: [{ type: 'INSULTS', confidence: 'HIGH' }],
    });
  });
});

describe('GuardrailService.checkGrounding', () => {
  /** ApplyGuardrail の応答を固定した GuardrailService */
  const serviceReturning = (filters: { type: string; score: number }[]) => {
    const service = new GuardrailService({
      get: (key: string, fallback?: string) =>
        key === 'BEDROCK_GUARDRAIL_ID' ? 'gr-test' : fallback,
    } as unknown as ConfigService);
    const send = jest.fn().mockResolvedValue({
      assessments: [{ contextualGroundingPolicy: { filters } }],
    });
    Object.assign(service, { client: { send } });
    return service;
  };

  it('根拠スコアと関連スコアを返す', async () => {
    const service = serviceReturning([
      { type: 'GROUNDING', score: 0.94 },
      { type: 'RELEVANCE', score: 0.8 },
    ]);
    await expect(service.checkGrounding('src', 'q', 'claim')).resolves.toEqual({
      grounding: 0.94,
      relevance: 0.8,
    });
  });

  it('Guardrail に根拠チェックの設定がなく、スコアが返らない場合は null を返す', async () => {
    const service = serviceReturning([]);
    await expect(
      service.checkGrounding('src', 'q', 'claim'),
    ).resolves.toBeNull();
  });
});

describe('GuardrailService.inspect', () => {
  /** ApplyGuardrail の応答を固定した GuardrailService */
  const serviceReturning = (
    textCharacters: { guarded: number; total: number } | undefined,
  ) => {
    const service = new GuardrailService({
      get: (key: string, fallback?: string) =>
        key === 'BEDROCK_GUARDRAIL_ID' ? 'gr-test' : fallback,
    } as unknown as ConfigService);
    const send = jest.fn().mockResolvedValue({
      assessments: [],
      guardrailCoverage: textCharacters && { textCharacters },
    });
    Object.assign(service, { client: { send } });
    return service;
  };

  it('requireFullCoverage では、チェックされなかった文字があれば例外を投げる', async () => {
    const service = serviceReturning({ guarded: 90, total: 100 });
    await expect(
      service.inspect('本文', 'INPUT', { requireFullCoverage: true }),
    ).rejects.toThrow('チェックしなかった文字');
  });

  it('requireFullCoverage では、カバレッジが返らない場合も例外を投げる', async () => {
    const service = serviceReturning(undefined);
    await expect(
      service.inspect('本文', 'INPUT', { requireFullCoverage: true }),
    ).rejects.toThrow('チェックしなかった文字');
  });

  it('requireFullCoverage でなければ、チェックされなかった文字があっても結果を返す', async () => {
    const service = serviceReturning({ guarded: 90, total: 100 });
    await expect(service.inspect('本文', 'INPUT')).resolves.toEqual({
      pii: [],
      words: [],
      content: [],
    });
  });

  it('すべての文字がチェックされていれば結果を返す', async () => {
    const service = serviceReturning({ guarded: 100, total: 100 });
    await expect(
      service.inspect('本文', 'INPUT', { requireFullCoverage: true }),
    ).resolves.toEqual({ pii: [], words: [], content: [] });
  });
});
