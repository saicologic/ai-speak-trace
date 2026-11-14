import type Anthropic from '@anthropic-ai/sdk';
import { estimateCostUsd } from './models';

/** usage を作る（指定しない項目は 0・null） */
function usage(partial: Partial<Anthropic.Usage>): Anthropic.Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    server_tool_use: null,
    inference_geo: null,
    service_tier: null,
    ...partial,
  };
}

const MILLION = 1_000_000;

describe('estimateCostUsd', () => {
  it('Sonnet 5.5 の入力・出力を、100 万トークンあたり $2・$10 で計算する', () => {
    expect(
      estimateCostUsd(
        'claude-sonnet-5-5',
        usage({ input_tokens: MILLION, output_tokens: MILLION }),
      ),
    ).toBeCloseTo(12, 10);
  });

  it('キャッシュの読み込み・5 分の書き込み・1 時間の書き込みを、それぞれの単価で計算する', () => {
    expect(
      estimateCostUsd(
        'claude-sonnet-5-5',
        usage({
          cache_read_input_tokens: MILLION,
          cache_creation_input_tokens: 2 * MILLION,
          cache_creation: {
            ephemeral_5m_input_tokens: MILLION,
            ephemeral_1h_input_tokens: MILLION,
          },
        }),
      ),
    ).toBeCloseTo(0.1 + 2.5 + 4, 10);
  });

  it('キャッシュの書き込みの内訳がないときは、5 分の単価で計算する', () => {
    expect(
      estimateCostUsd(
        'claude-opus-5-5',
        usage({ cache_creation_input_tokens: MILLION }),
      ),
    ).toBeCloseTo(5, 10);
  });

  it('Haiku 5.5 は、入力とキャッシュの合計がちょうど 10 万トークンなら低い単価で計算する', () => {
    expect(
      estimateCostUsd(
        'claude-haiku-5-5',
        usage({
          input_tokens: 60_000,
          cache_read_input_tokens: 40_000,
          output_tokens: 10_000,
        }),
      ),
    ).toBeCloseTo((60_000 * 0.1 + 40_000 * 0.01 + 10_000 * 0.5) / MILLION, 10);
  });

  it('Haiku 5.5 は、入力とキャッシュの合計が 10 万トークンを超えると、すべてを高い単価で計算する', () => {
    expect(
      estimateCostUsd(
        'claude-haiku-5-5',
        usage({
          input_tokens: 60_000,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 1,
          output_tokens: 10_000,
        }),
      ),
    ).toBeCloseTo(
      (60_000 * 0.5 + 40_000 * 0.05 + 1 * 0.625 + 10_000 * 2.5) / MILLION,
      10,
    );
  });

  it('Haiku 5.5 の 10 万トークンの境目は、キャッシュの書き込みの内訳があれば内訳の合計で数える', () => {
    expect(
      estimateCostUsd(
        'claude-haiku-5-5',
        usage({
          input_tokens: 60_000,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: null,
          cache_creation: {
            ephemeral_5m_input_tokens: 1,
            ephemeral_1h_input_tokens: 0,
          },
        }),
      ),
    ).toBeCloseTo((60_000 * 0.5 + 40_000 * 0.05 + 1 * 0.625) / MILLION, 10);
  });

  it('Web 検索は、1,000 回あたり $10 を足す', () => {
    expect(
      estimateCostUsd(
        'claude-sonnet-5-5',
        usage({
          server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
        }),
      ),
    ).toBeCloseTo(0.03, 10);
  });

  it('単価の表にないモデルは、費用を null（不明）にする', () => {
    expect(
      estimateCostUsd('claude-unknown-1', usage({ input_tokens: 100 })),
    ).toBeNull();
  });

  it('キャッシュの項目が null のときは、0 として計算する', () => {
    expect(
      estimateCostUsd(
        'claude-sonnet-5-5',
        usage({ input_tokens: MILLION, cache_read_input_tokens: null }),
      ),
    ).toBeCloseTo(2, 10);
  });
});
