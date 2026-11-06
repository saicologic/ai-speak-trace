import { describe, it, expect } from 'vitest';
import { finishedStages, resumeLabel } from './researchResume';
import type { ResearchJob } from '../types/research';

const job: ResearchJob = {
  id: 'job-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'failed',
  transcriptionIds: ['t1'],
  transcriptionNames: { t1: 'a.mp3' },
  models: { analysis: 'model' },
};
const source = { url: 'https://example.com', title: 'a', domain: 'example.com', official: false, excerpts: [] };

describe('resumeLabel', () => {
  it('再開する段階を文言に入れ、失敗したキーワードだけ調べ直す場合は数を出す', () => {
    expect(resumeLabel({ from: 'proposing' })).toBe('②キーワードの提案から再開');
    expect(resumeLabel({ from: 'researching' })).toBe('③Web調査から再開');
    expect(resumeLabel({ from: 'researching', retryKeywords: ['MCP', 'ハーネス'] })).toBe(
      '失敗した2個のキーワードを調べ直して再開',
    );
    expect(resumeLabel({ from: 'analyzing' })).toBe('④統合分析から再開');
    expect(resumeLabel({ from: 'evaluating' })).toBe('⑤最終確認から再開');
  });
});

describe('finishedStages', () => {
  it('保存されている結果から、終わっている段階を並べる', () => {
    expect(finishedStages(job)).toEqual([]);
    expect(
      finishedStages({ ...job, proposal: { keywords: [], domains: [] }, webSources: [source, source] }),
    ).toEqual(['キーワードの提案', 'Web調査（情報源2件）']);
  });

  it('Web調査が途中で止まった場合は、終わっていないキーワードの数を出す', () => {
    expect(
      finishedStages({
        ...job,
        webSources: [source],
        resume: { from: 'researching', retryKeywords: ['MCP'] },
      }),
    ).toEqual(['Web調査（情報源1件・1個のキーワードは未完了）']);
  });
});
