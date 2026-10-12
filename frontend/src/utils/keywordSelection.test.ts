import { keepAvailable } from './keywordSelection';

describe('keepAvailable', () => {
  it('今の一覧にある語だけを残す', () => {
    const result = keepAvailable(new Set(['品質', 'AI']), [{ text: 'AI', count: 3 }]);
    expect([...result]).toEqual(['AI']);
  });

  it('変わらない場合は同じ Set を返す', () => {
    const selected = new Set(['AI']);
    expect(keepAvailable(selected, [{ text: 'AI', count: 1 }])).toBe(selected);
  });
});
