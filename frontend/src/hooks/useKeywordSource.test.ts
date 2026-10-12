import { act, renderHook, waitFor } from '@testing-library/react';
import { readKeywordSource, saveKeywordSource, useKeywordSource } from './useKeywordSource';
import { fetchGinzaKeywords, fetchGinzaStatus } from '../api/client';

vi.mock('../api/client');

describe('useKeywordSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(fetchGinzaStatus).mockResolvedValue({ state: 'ready', message: '' });
    vi.mocked(fetchGinzaKeywords).mockResolvedValue({
      keywords: [{ text: '品質', count: 2 }],
      bySpeaker: {},
    });
  });

  it('選んだ出し方を会話ごとに保存する（保存していない会話は標準）', () => {
    saveKeywordSource('t1', 'ginza');
    expect(readKeywordSource('t1')).toBe('ginza');
    expect(readKeywordSource('t2')).toBe('standard');
  });

  it('ベータ機能が無効なら、GiNZA を選んでいても標準にし、GiNZA を呼ばない', () => {
    saveKeywordSource('t1', 'ginza');
    const { result } = renderHook(() => useKeywordSource('t1', false));
    expect(result.current.source).toBe('standard');
    expect(fetchGinzaStatus).not.toHaveBeenCalled();
  });

  it('GiNZA を選ぶと、準備ができていればキーワードを取り出す', async () => {
    const { result } = renderHook(() => useKeywordSource('t1', true));
    expect(result.current.source).toBe('standard');

    act(() => result.current.setSource('ginza'));

    await waitFor(() => expect(result.current.ginza?.keywords).toEqual([{ text: '品質', count: 2 }]));
    expect(fetchGinzaKeywords).toHaveBeenCalledWith('t1');
    expect(readKeywordSource('t1')).toBe('ginza');
  });

  it('GiNZA が入っていなければ、キーワードを取り出さずに状態を返す', async () => {
    vi.mocked(fetchGinzaStatus).mockResolvedValue({
      state: 'not_installed',
      message: 'GiNZA が入っていません',
    });
    saveKeywordSource('t1', 'ginza');
    const { result } = renderHook(() => useKeywordSource('t1', true));

    await waitFor(() => expect(result.current.status?.state).toBe('not_installed'));
    expect(fetchGinzaKeywords).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});
