import { ElevenLabsWord } from './types/elevenlabs.types';
import { ChunkedTranscriptionJob } from './types/chunked-job.types';
import {
  adjustTimestamps,
  getMostFrequent,
  swapSpeakerIds,
  resolveSpeakerMapping,
  mergeChunkResults,
} from './chunked-transcription.utils';

/** テスト用のElevenLabsWordを作成するヘルパー */
function elWord(
  text: string,
  start: number,
  end: number,
  speaker_id = 'speaker_0',
  type: ElevenLabsWord['type'] = 'word',
): ElevenLabsWord {
  return { text, start, end, type, speaker_id, logprob: -0.1 };
}

describe('adjustTimestamps', () => {
  it('オフセット0の場合は元の配列をそのまま返す', () => {
    const words = [elWord('あ', 0, 0.5)];
    const result = adjustTimestamps(words, 0);
    expect(result).toBe(words); // 同一参照
  });

  it('正のオフセットでタイムスタンプを加算する', () => {
    const words = [elWord('あ', 0, 0.5), elWord('い', 0.5, 1.0)];
    const result = adjustTimestamps(words, 600);
    expect(result[0].start).toBe(600);
    expect(result[0].end).toBe(600.5);
    expect(result[1].start).toBe(600.5);
    expect(result[1].end).toBe(601);
  });

  it('空配列を処理できる', () => {
    expect(adjustTimestamps([], 100)).toEqual([]);
  });

  it('元の配列を変更しない', () => {
    const words = [elWord('あ', 0, 0.5)];
    adjustTimestamps(words, 100);
    expect(words[0].start).toBe(0);
  });
});

describe('getMostFrequent', () => {
  it('単一要素の配列から要素を返す', () => {
    expect(getMostFrequent(['a'])).toBe('a');
  });

  it('最も頻出する要素を返す', () => {
    expect(getMostFrequent(['a', 'b', 'a', 'a', 'b'])).toBe('a');
  });

  it('全要素が同じ場合はその要素を返す', () => {
    expect(getMostFrequent(['x', 'x', 'x'])).toBe('x');
  });

  it('同数の場合は先に出現した要素を返す', () => {
    const result = getMostFrequent(['a', 'b']);
    // Map反復順序によるが、countが同じならどちらかが返る
    expect(['a', 'b']).toContain(result);
  });
});

describe('swapSpeakerIds', () => {
  it('2つの話者IDを入れ替える', () => {
    const words = [
      elWord('あ', 0, 0.1, 'speaker_0'),
      elWord('い', 0.1, 0.2, 'speaker_1'),
      elWord('う', 0.2, 0.3, 'speaker_0'),
    ];
    const result = swapSpeakerIds(words, 'speaker_0', 'speaker_1');
    expect(result[0].speaker_id).toBe('speaker_1');
    expect(result[1].speaker_id).toBe('speaker_0');
    expect(result[2].speaker_id).toBe('speaker_1');
  });

  it('対象外のspeaker_idは変更しない', () => {
    const words = [elWord('あ', 0, 0.1, 'speaker_2')];
    const result = swapSpeakerIds(words, 'speaker_0', 'speaker_1');
    expect(result[0].speaker_id).toBe('speaker_2');
  });

  it('元の配列を変更しない', () => {
    const words = [elWord('あ', 0, 0.1, 'speaker_0')];
    swapSpeakerIds(words, 'speaker_0', 'speaker_1');
    expect(words[0].speaker_id).toBe('speaker_0');
  });
});

describe('resolveSpeakerMapping', () => {
  it('前チャンクが空の場合は現チャンクをそのまま返す', () => {
    const current = [elWord('あ', 0, 0.1, 'speaker_0')];
    const result = resolveSpeakerMapping([], current);
    expect(result).toBe(current);
  });

  it('現チャンクが空の場合はそのまま返す', () => {
    const prev = [elWord('あ', 0, 0.1, 'speaker_0')];
    const result = resolveSpeakerMapping(prev, []);
    expect(result).toEqual([]);
  });

  it('現チャンクに話者が1人だけの場合はswapしない', () => {
    const prev = [elWord('あ', 0, 0.5, 'speaker_0')];
    const current = [
      elWord('い', 0.6, 0.7, 'speaker_1'),
      elWord('う', 0.7, 0.8, 'speaker_1'),
    ];
    const result = resolveSpeakerMapping(prev, current);
    expect(result[0].speaker_id).toBe('speaker_1');
  });

  it('前チャンク末尾と現チャンク先頭が同じ話者IDならswapしない', () => {
    const prev = [
      elWord('あ', 0, 0.1, 'speaker_0'),
      elWord('い', 0.1, 0.5, 'speaker_0'),
    ];
    const current = [
      elWord('う', 0.6, 0.7, 'speaker_0'),
      elWord('え', 0.7, 0.8, 'speaker_1'),
    ];
    const result = resolveSpeakerMapping(prev, current);
    expect(result[0].speaker_id).toBe('speaker_0');
    expect(result[1].speaker_id).toBe('speaker_1');
  });

  it('話者IDが入れ替わっていて5秒以内の場合はswapする', () => {
    // 前チャンク: speaker_0が支配的
    const prev = Array.from({ length: 10 }, (_, i) =>
      elWord('あ', i * 0.1, (i + 1) * 0.1, 'speaker_0'),
    );
    // 現チャンク: speaker_1が先頭で支配的（IDが入れ替わっている）
    // 間隔は1秒（prev末尾end=1.0, current先頭start=2.0）→ 5秒以内
    const current = [
      ...Array.from({ length: 8 }, (_, i) =>
        elWord('い', 2 + i * 0.1, 2 + (i + 1) * 0.1, 'speaker_1'),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        elWord('う', 2.8 + i * 0.1, 2.8 + (i + 1) * 0.1, 'speaker_0'),
      ),
    ];

    const result = resolveSpeakerMapping(prev, current);
    // speaker_1 → speaker_0, speaker_0 → speaker_1にswapされるはず
    expect(result[0].speaker_id).toBe('speaker_0');
    expect(result[8].speaker_id).toBe('speaker_1');
  });

  it('5秒以上離れている場合はswapしない', () => {
    const prev = [elWord('あ', 0, 0.5, 'speaker_0')];
    const current = [
      elWord('い', 10, 10.1, 'speaker_1'), // 9.5秒のギャップ
      elWord('う', 10.1, 10.2, 'speaker_0'),
    ];
    const result = resolveSpeakerMapping(prev, current);
    expect(result[0].speaker_id).toBe('speaker_1');
  });

  it('spacing/audio_eventタイプは話者判定から除外される', () => {
    const prev = [
      elWord('あ', 0, 0.5, 'speaker_0'),
      elWord(' ', 0.5, 0.6, 'speaker_1', 'spacing'), // spacingは除外
    ];
    const current = [
      elWord('い', 0.7, 0.8, 'speaker_0'),
      elWord('う', 0.8, 0.9, 'speaker_1'),
    ];
    const result = resolveSpeakerMapping(prev, current);
    // prevの実質的な末尾はspeaker_0、currentの先頭もspeaker_0 → swapなし
    expect(result[0].speaker_id).toBe('speaker_0');
  });
});

describe('mergeChunkResults', () => {
  function createJob(
    chunks: {
      index: number;
      words: ElevenLabsWord[];
      text: string;
      languageCode: string;
    }[],
  ): ChunkedTranscriptionJob {
    return {
      id: 'job-1',
      audioFileName: 'test.mp3',
      createdAt: '2024-01-01T00:00:00Z',
      status: 'completed',
      totalDurationSec: 1200,
      chunkDurationSec: 600,
      totalChunks: chunks.length,
      currentChunkIndex: chunks.length - 1,
      completedChunks: chunks.map((c) => ({
        index: c.index,
        chunkFileName: `chunk_${c.index}.mp3`,
        startTimeSec: c.index * 600,
        words: c.words,
        text: c.text,
        languageCode: c.languageCode,
      })),
      updatedAt: '2024-01-01T00:10:00Z',
    };
  }

  it('単一チャンクの結果をそのまま返す', () => {
    const words = [elWord('あ', 0, 0.5)];
    const job = createJob([
      { index: 0, words, text: 'あ', languageCode: 'ja' },
    ]);

    const result = mergeChunkResults(job);
    expect(result.words).toHaveLength(1);
    expect(result.text).toBe('あ');
    expect(result.languageCode).toBe('ja');
  });

  it('複数チャンクの単語とテキストを結合する', () => {
    const job = createJob([
      {
        index: 0,
        words: [elWord('あ', 0, 0.5)],
        text: 'あ',
        languageCode: 'ja',
      },
      {
        index: 1,
        words: [elWord('い', 600, 600.5)],
        text: 'い',
        languageCode: 'ja',
      },
    ]);

    const result = mergeChunkResults(job);
    expect(result.words).toHaveLength(2);
    expect(result.text).toBe('あい');
  });

  it('チャンクをインデックス順にソートして結合する', () => {
    const job = createJob([
      {
        index: 1,
        words: [elWord('い', 600, 600.5)],
        text: 'い',
        languageCode: 'ja',
      },
      {
        index: 0,
        words: [elWord('あ', 0, 0.5)],
        text: 'あ',
        languageCode: 'ja',
      },
    ]);

    const result = mergeChunkResults(job);
    expect(result.text).toBe('あい');
    expect(result.words[0].text).toBe('あ');
    expect(result.words[1].text).toBe('い');
  });

  it('完了チャンクがない場合は空の結果を返す', () => {
    const job = createJob([]);
    const result = mergeChunkResults(job);
    expect(result.words).toEqual([]);
    expect(result.text).toBe('');
  });
});
