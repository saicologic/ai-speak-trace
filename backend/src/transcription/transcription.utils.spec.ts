import { TranscriptionWord } from './types/transcription.types';
import {
  mergeWordsIntoPhrases,
  buildSpeakers,
  groupWordsIntoUtterances,
  convertWords,
  generateSpeakerName,
} from './transcription.utils';
import { ElevenLabsWord } from './types/elevenlabs.types';

/** テスト用のTranscriptionWordを作成するヘルパー */
function word(
  text: string,
  start: number,
  end: number,
  speakerId = 'speaker_0',
  type: TranscriptionWord['type'] = 'word',
): TranscriptionWord {
  return { text, start, end, speakerId, type };
}

describe('convertWords', () => {
  it('ElevenLabsの単語データを内部型に変換する', () => {
    const elWords: ElevenLabsWord[] = [
      {
        text: 'こんにちは',
        start: 0,
        end: 1,
        type: 'word',
        speaker_id: 'speaker_0',
        logprob: -0.1,
      },
      {
        text: ' ',
        start: 1,
        end: 1.1,
        type: 'spacing',
        speaker_id: 'speaker_0',
        logprob: -0.1,
      },
    ];

    const result = convertWords(elWords);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      text: 'こんにちは',
      start: 0,
      end: 1,
      type: 'word',
      speakerId: 'speaker_0',
    });
  });

  it('空配列を処理できる', () => {
    expect(convertWords([])).toEqual([]);
  });
});

describe('mergeWordsIntoPhrases', () => {
  it('空配列を処理できる', () => {
    expect(mergeWordsIntoPhrases([])).toEqual([]);
  });

  it('単一の単語はそのまま返す', () => {
    const words = [word('あ', 0, 0.1)];
    const result = mergeWordsIntoPhrases(words);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('あ');
  });

  it('連続する同一話者の文字を1つのフレーズに結合する', () => {
    const words = [
      word('こ', 0, 0.1),
      word('ん', 0.1, 0.2),
      word('に', 0.2, 0.3),
      word('ち', 0.3, 0.4),
      word('は', 0.4, 0.5),
    ];
    const result = mergeWordsIntoPhrases(words);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('こんにちは');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(0.5);
  });

  it('句読点でフレーズを分割する', () => {
    const words = [
      word('は', 0, 0.1),
      word('い', 0.1, 0.2),
      word('。', 0.2, 0.3),
      word('そ', 0.3, 0.4),
      word('う', 0.4, 0.5),
    ];
    const result = mergeWordsIntoPhrases(words);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].text).toBe('はい。');
    expect(result[1].text).toBe('そう');
  });

  it('0.5秒以上の無音でフレーズを分割する', () => {
    const words = [
      word('あ', 0, 0.1),
      word('い', 0.1, 0.2),
      word('う', 1.0, 1.1), // 0.8秒のギャップ
    ];
    const result = mergeWordsIntoPhrases(words);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('あい');
    expect(result[1].text).toBe('う');
  });

  it('話者が変わるとフレーズを分割する', () => {
    const words = [
      word('あ', 0, 0.1, 'speaker_0'),
      word('い', 0.1, 0.2, 'speaker_0'),
      word('う', 0.2, 0.3, 'speaker_1'),
      word('え', 0.3, 0.4, 'speaker_1'),
    ];
    const result = mergeWordsIntoPhrases(words);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('あい');
    expect(result[0].speakerId).toBe('speaker_0');
    expect(result[1].text).toBe('うえ');
    expect(result[1].speakerId).toBe('speaker_1');
  });

  it('spacing/audio_eventタイプの単語でフレーズを分割する', () => {
    const words = [
      word('あ', 0, 0.1),
      word(' ', 0.1, 0.2, 'speaker_0', 'spacing'),
      word('い', 0.2, 0.3),
    ];
    const result = mergeWordsIntoPhrases(words);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('あ');
    expect(result[1].type).toBe('spacing');
    expect(result[2].text).toBe('い');
  });

  it('配列末尾がnon-wordタイプで終わる場合も正しく処理する', () => {
    const words = [
      word('あ', 0, 0.1),
      word('い', 0.1, 0.2),
      word(' ', 0.2, 0.3, 'speaker_0', 'spacing'),
    ];
    const result = mergeWordsIntoPhrases(words);
    // non-wordの後に次のwordがないため、currentが再度pushされる（計3要素）
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('あい');
    expect(result[1].type).toBe('spacing');
    // 末尾のcurrentは直前のフレーズのコピー
    expect(result[2].text).toBe('あい');
  });
});

describe('generateSpeakerName', () => {
  it('インデックス0〜2でA〜Cさんを返す', () => {
    expect(generateSpeakerName(0)).toBe('Aさん');
    expect(generateSpeakerName(1)).toBe('Bさん');
    expect(generateSpeakerName(2)).toBe('Cさん');
  });

  it('インデックス25でZさんを返す', () => {
    expect(generateSpeakerName(25)).toBe('Zさん');
  });

  it('インデックス26以上でAA、ABさんを返す', () => {
    expect(generateSpeakerName(26)).toBe('AAさん');
    expect(generateSpeakerName(27)).toBe('ABさん');
  });
});

describe('buildSpeakers', () => {
  it('空配列から空の話者リストを返す', () => {
    expect(buildSpeakers([])).toEqual([]);
  });

  it('1人の話者を正しく構築する', () => {
    const words = [word('あ', 0, 0.1, 'speaker_0')];
    const speakers = buildSpeakers(words);
    expect(speakers).toHaveLength(1);
    expect(speakers[0]).toEqual({
      id: 'speaker_0',
      name: 'Aさん',
      color: '#3B82F6',
    });
  });

  it('2人の話者をデフォルト名・色で構築する', () => {
    const words = [
      word('あ', 0, 0.1, 'speaker_0'),
      word('い', 0.1, 0.2, 'speaker_1'),
    ];
    const speakers = buildSpeakers(words);
    expect(speakers).toHaveLength(2);
    expect(speakers[0].name).toBe('Aさん');
    expect(speakers[0].color).toBe('#3B82F6');
    expect(speakers[1].name).toBe('Bさん');
    expect(speakers[1].color).toBe('#EF4444');
  });

  it('3人以上の話者にもアルファベット順の名前を割り当てる', () => {
    const words = [
      word('あ', 0, 0.1, 'speaker_0'),
      word('い', 0.1, 0.2, 'speaker_1'),
      word('う', 0.2, 0.3, 'speaker_2'),
    ];
    const speakers = buildSpeakers(words);
    expect(speakers).toHaveLength(3);
    expect(speakers[2].name).toBe('Cさん');
    expect(speakers[2].color).toBe('#6B7280');
  });

  it('話者IDをソート順で返す', () => {
    const words = [
      word('い', 0, 0.1, 'speaker_1'),
      word('あ', 0.1, 0.2, 'speaker_0'),
    ];
    const speakers = buildSpeakers(words);
    expect(speakers[0].id).toBe('speaker_0');
    expect(speakers[1].id).toBe('speaker_1');
  });
});

describe('groupWordsIntoUtterances', () => {
  it('空配列から空の発話リストを返す', () => {
    expect(groupWordsIntoUtterances([], [])).toEqual([]);
  });

  it('同一話者の連続ワードを1つのUtteranceにまとめる', () => {
    const words = [
      word('こんにちは', 0, 1, 'speaker_0'),
      word('世界', 1, 2, 'speaker_0'),
    ];
    const speakers = [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }];

    const result = groupWordsIntoUtterances(words, speakers);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('こんにちは世界');
    expect(result[0].speakerName).toBe('Aさん');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(2);
    expect(result[0].words).toHaveLength(2);
  });

  it('話者交代で新しいUtteranceを作成する', () => {
    const words = [
      word('はい', 0, 1, 'speaker_0'),
      word('いいえ', 1, 2, 'speaker_1'),
      word('そう', 2, 3, 'speaker_0'),
    ];
    const speakers = [
      { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
      { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
    ];

    const result = groupWordsIntoUtterances(words, speakers);
    expect(result).toHaveLength(3);
    expect(result[0].speakerName).toBe('Aさん');
    expect(result[1].speakerName).toBe('Bさん');
    expect(result[2].speakerName).toBe('Aさん');
  });

  it('話者が見つからない場合はspeakerIdをspeakerNameに使う', () => {
    const words = [word('あ', 0, 1, 'unknown_speaker')];
    const speakers = [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }];

    const result = groupWordsIntoUtterances(words, speakers);
    expect(result[0].speakerName).toBe('unknown_speaker');
  });
});
