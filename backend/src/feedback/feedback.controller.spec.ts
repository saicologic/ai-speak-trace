import { BadRequestException } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

describe('FeedbackController', () => {
  let service: { create: jest.Mock; find: jest.Mock };
  let controller: FeedbackController;

  const valid = {
    feature: 'summary',
    targetId: 'log-1',
    transcriptionId: 't1',
    category: 'factual_error',
    quote: ' 誤りの箇所 ',
    comment: '',
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockImplementation((input: object) => ({
        id: 'f1',
        ...input,
      })),
      find: jest.fn().mockResolvedValue([]),
    };
    controller = new FeedbackController(service as unknown as FeedbackService);
  });

  it('報告を保存する（前後の空白は除く）', async () => {
    await controller.create(valid);
    expect(service.create).toHaveBeenCalledWith({
      feature: 'summary',
      targetId: 'log-1',
      transcriptionId: 't1',
      category: 'factual_error',
      quote: '誤りの箇所',
      comment: '',
    });
  });

  it.each([
    [{ feature: 'unknown' }, 'feature'],
    [{ category: 'unknown' }, 'category'],
    [{ transcriptionId: '' }, 'transcriptionId'],
    [{ comment: 42 }, 'comment'],
    [{ quote: 'あ'.repeat(1001) }, 'quote'],
    [{ category: 'other', quote: '', comment: '' }, '内容を書いて'],
  ])('不正な入力は保存しない: %o', async (override, message) => {
    await expect(controller.create({ ...valid, ...override })).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.create({ ...valid, ...override })).rejects.toThrow(
      message,
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('一覧を機能と結果の ID で絞り込む', async () => {
    await controller.find('summary', 'log-1');
    expect(service.find).toHaveBeenCalledWith({
      feature: 'summary',
      targetId: 'log-1',
    });
  });
});
