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

describe('ResearchClaudeService.researchKeyword', () => {
  const source = (url: string, chars: number): WebSource => ({
    url,
    title: url,
    domain: new URL(url).hostname,
    official: url.includes('official.com'),
    excerpts: chars > 0 ? ['あ'.repeat(chars)] : [],
  });

  /** Web 検索を差し替えた ResearchClaudeService（公式サイトの検索と一般のサイトの検索の結果を返す） */
  const serviceWith = (
    official: { sources: WebSource[]; text: string; outsideAllowed?: boolean },
    general: WebSource[] | Error,
  ) => {
    const service = new ResearchClaudeService({} as ClaudeClientService);
    const searchWeb = jest.fn(
      (_prompt: string, _count: number, allowed?: string[]) => {
        if (allowed)
          return Promise.resolve({ outsideAllowed: false, ...official });
        return general instanceof Error
          ? Promise.reject(general)
          : Promise.resolve({
              sources: general,
              text: '',
              outsideAllowed: false,
            });
      },
    );
    Object.assign(service, { searchWeb });
    const research = (keyword: string, domains: string[]) =>
      (
        service as unknown as {
          researchKeyword: (k: string, d: string[]) => Promise<WebSource[]>;
        }
      ).researchKeyword(keyword, domains);
    return { research, searchWeb };
  };

  it('公式サイトの情報が十分で定義もわかれば、一般のサイトは調べない', async () => {
    const { research, searchWeb } = serviceWith(
      { sources: [source('https://official.com/a', 600)], text: '定義: あり' },
      [source('https://other.com/a', 600)],
    );
    const sources = await research('a', ['official.com']);
    expect(sources.map((s) => s.url)).toEqual(['https://official.com/a']);
    expect(searchWeb).toHaveBeenCalledTimes(1);
  });

  it('公式サイトの情報が少なければ、公式サイトの情報を残して一般のサイトの情報を足す', async () => {
    const { research, searchWeb } = serviceWith(
      { sources: [source('https://official.com/a', 203)], text: '定義: あり' },
      [source('https://other.com/a', 600)],
    );
    const sources = await research('a', ['official.com']);
    expect(sources.map((s) => s.url)).toEqual([
      'https://official.com/a',
      'https://other.com/a',
    ]);
    expect(searchWeb).toHaveBeenCalledTimes(2);
  });

  it('公式サイトの情報で定義がわからなければ、一般のサイトも調べる', async () => {
    const { research, searchWeb } = serviceWith(
      { sources: [source('https://official.com/a', 600)], text: '定義: なし' },
      [source('https://other.com/a', 600)],
    );
    await research('a', ['official.com']);
    expect(searchWeb).toHaveBeenCalledTimes(2);
  });

  it('選んだサイト以外の検索結果が返った場合は、「定義: あり」を使わずに判定する', async () => {
    const { research, searchWeb } = serviceWith(
      {
        sources: [source('https://official.com/a', 600)],
        text: '定義: あり',
        outsideAllowed: true,
      },
      [source('https://other.com/a', 600)],
    );
    await research('a', ['official.com']);
    // 抜粋は十分なため、文字数では一般のサイトを調べない
    expect(searchWeb).toHaveBeenCalledTimes(1);
  });

  it('選んだサイト以外の検索結果が返っても、「定義: なし」なら一般のサイトも調べる', async () => {
    const { research, searchWeb } = serviceWith(
      {
        sources: [source('https://official.com/a', 600)],
        text: '定義: なし',
        outsideAllowed: true,
      },
      [source('https://other.com/a', 600)],
    );
    await research('a', ['official.com']);
    expect(searchWeb).toHaveBeenCalledTimes(2);
  });

  it('一般のサイトの検索に失敗しても、公式サイトの抜粋があれば公式サイトの情報を返す', async () => {
    const { research } = serviceWith(
      { sources: [source('https://official.com/a', 203)], text: '定義: あり' },
      new Error('rate limit'),
    );
    const sources = await research('a', ['official.com']);
    expect(sources.map((s) => s.url)).toEqual(['https://official.com/a']);
  });

  it('一般のサイトの検索に失敗し、公式サイトの抜粋もなければ、例外を投げる', async () => {
    const { research } = serviceWith(
      { sources: [source('https://official.com/a', 0)], text: '' },
      new Error('rate limit'),
    );
    await expect(research('a', ['official.com'])).rejects.toThrow('rate limit');
  });

  it('公式サイトを選ばなかった場合は、一般のサイトだけを調べる', async () => {
    const { research, searchWeb } = serviceWith({ sources: [], text: '' }, [
      source('https://other.com/a', 600),
    ]);
    const sources = await research('a', []);
    expect(sources.map((s) => s.url)).toEqual(['https://other.com/a']);
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(searchWeb.mock.calls[0][2]).toBeUndefined();
  });
});

describe('ResearchClaudeService の呼び出しの記録', () => {
  it('キーワードの提案を、research-proposal として記録する', async () => {
    const createMessage = jest.fn(() =>
      Promise.resolve({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"title":"t","keywords":[]}' }],
      }),
    );
    const service = new ResearchClaudeService({
      createMessage,
    } as unknown as ClaudeClientService);
    await service.proposeKeywords(
      [{ id: 't1', name: 'a.mp3', text: '会話', utterances: [] }],
      [],
    );
    expect(createMessage).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'research-proposal',
    });
  });
});
