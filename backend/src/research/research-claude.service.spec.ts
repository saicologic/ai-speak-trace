import { ClaudeClientService } from '../claude/claude-client.service';
import { ResearchClaudeService } from './research-claude.service';
import { WebSource } from './types/research.types';

describe('ResearchClaudeService.researchWeb', () => {
  const page = (url: string): WebSource => ({
    url,
    title: url,
    domain: 'a.com',
    official: true,
    excerpts: ['抜粋'],
  });

  /** キーワードごとの調査を差し替えた ResearchClaudeService */
  const serviceWith = (research: (keyword: string) => Promise<WebSource[]>) => {
    const service = new ResearchClaudeService({} as ClaudeClientService);
    Object.assign(service, { researchKeyword: research });
    return service;
  };

  it('一部のキーワードの調査に失敗しても、ほかのキーワードの結果で続ける', async () => {
    const service = serviceWith((keyword) =>
      keyword === '失敗'
        ? Promise.reject(new Error('rate limit'))
        : Promise.resolve([page(`https://a.com/${keyword}`)]),
    );
    const result = await service.researchWeb([
      { keyword: '成功', domains: [] },
      { keyword: '失敗', domains: [] },
    ]);
    expect(result.sources.map((s) => s.url)).toEqual(['https://a.com/成功']);
    expect(result.failures).toEqual([{ keyword: '失敗', error: 'rate limit' }]);
  });

  it('一部のキーワードで失敗し、残りのキーワードでも抜粋がない場合は、例外を投げる', async () => {
    const service = serviceWith((keyword) =>
      keyword === '失敗'
        ? Promise.reject(new Error('rate limit'))
        : Promise.resolve([{ ...page('https://a.com/空'), excerpts: [] }]),
    );
    await expect(
      service.researchWeb([
        { keyword: '空', domains: [] },
        { keyword: '失敗', domains: [] },
      ]),
    ).rejects.toThrow('分析に使える情報源が見つかりませんでした');
  });

  it('すべてのキーワードで失敗した場合は、例外を投げる', async () => {
    const service = serviceWith(() => Promise.reject(new Error('rate limit')));
    await expect(
      service.researchWeb([{ keyword: 'a', domains: [] }]),
    ).rejects.toThrow('すべてのキーワードで Web調査に失敗しました');
  });
});
