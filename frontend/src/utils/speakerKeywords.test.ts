import { keywordsFor } from './speakerKeywords';
import type { GinzaKeywords, Utterance } from '../types';

const utterance = (speakerId: string, text: string): Utterance =>
  ({ speakerId, speakerName: speakerId, start: 0, end: 1, text, words: [] }) as Utterance;

const utterances = [
  utterance('a', 'テックリードとテックリード'),
  utterance('b', 'カジュアル面談'),
];

const ginza: GinzaKeywords = {
  keywords: [{ text: '評価', count: 3 }],
  bySpeaker: { a: [{ text: '品質', count: 2 }], b: [] },
};

describe('keywordsFor', () => {
  it('標準で話者を選ばない場合は、会話全体から取り出す', () => {
    expect(keywordsFor(utterances, 'standard', null, null).map((k) => k.text)).toEqual([
      'テックリード',
      'カジュアル面談',
    ]);
  });

  it('標準で話者を選ばない場合、fullText があればそれから取り出す', () => {
    expect(keywordsFor(utterances, 'standard', null, null, 'プロダクト開発')).toEqual([
      { text: 'プロダクト開発', count: 1 },
    ]);
  });

  it('標準で話者を選んだ場合は、その話者の発話だけから取り出す', () => {
    expect(keywordsFor(utterances, 'standard', null, 'b')).toEqual([
      { text: 'カジュアル面談', count: 1 },
    ]);
  });

  it('GiNZA は、話者を選ばない場合は全体、選んだ場合はその話者の結果を使う', () => {
    expect(keywordsFor(utterances, 'ginza', ginza, null)).toEqual(ginza.keywords);
    expect(keywordsFor(utterances, 'ginza', ginza, 'a')).toEqual([{ text: '品質', count: 2 }]);
    expect(keywordsFor(utterances, 'ginza', ginza, 'x')).toEqual([]);
  });

  it('GiNZA の取り出し中は空にする', () => {
    expect(keywordsFor(utterances, 'ginza', null, null)).toEqual([]);
  });
});
