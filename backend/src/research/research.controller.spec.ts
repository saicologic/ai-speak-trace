import { BadRequestException } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';

describe('ResearchController', () => {
  const service = {
    start: jest.fn(() => Promise.resolve({ id: 'job' })),
    confirm: jest.fn(() => Promise.resolve({ id: 'job' })),
  };
  const controller = new ResearchController(
    service as unknown as ResearchService,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [{ transcriptionIds: 't1' }],
    [{ transcriptionIds: [1] }],
    [{ transcriptionIds: ['t1'], frequentWords: 'x' }],
    [{ transcriptionIds: ['t1'], frequentWords: [{ word: 1, count: 1 }] }],
  ])('開始: 不正な入力は 400 にする %j', async (body) => {
    await expect(controller.start(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.start).not.toHaveBeenCalled();
  });

  it('開始: 正しい入力はサービスに渡す', async () => {
    await controller.start({
      transcriptionIds: ['t1'],
      frequentWords: [{ word: 'ハーネス', count: 3 }],
    });
    expect(service.start).toHaveBeenCalledWith(
      ['t1'],
      [{ word: 'ハーネス', count: 3 }],
    );
  });

  it('確定: キーワードごとの公式サイトをサービスに渡す', async () => {
    const targets = [{ keyword: 'ハーネス', domains: ['anthropic.com'] }];
    await controller.confirm('job', { targets });
    expect(service.confirm).toHaveBeenCalledWith('job', targets);
  });

  it('確定: 以前の形式は、すべてのキーワードで同じ公式サイトを調べる', async () => {
    await controller.confirm('job', {
      keywords: ['a', 'b'],
      domains: ['x.com'],
    });
    expect(service.confirm).toHaveBeenCalledWith('job', [
      { keyword: 'a', domains: ['x.com'] },
      { keyword: 'b', domains: ['x.com'] },
    ]);
  });

  it.each([
    [{ keywords: 'abc' }],
    [{ keywords: ['a'], domains: [null] }],
    [{ targets: [{ keyword: 'a', domains: [1] }] }],
    [{ targets: 'a' }],
  ])('確定: 不正な入力は 400 にする %j', async (body) => {
    await expect(controller.confirm('job', body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.confirm).not.toHaveBeenCalled();
  });
});
