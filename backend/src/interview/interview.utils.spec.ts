import { verifySummaryEvidence } from './interview.utils';
import { Utterance } from '../transcription/types/transcription.types';

const utterances: Utterance[] = [
  {
    speakerId: 's0',
    speakerName: 'Aさん',
    start: 0,
    end: 1,
    text: '今日はRAGの話をします',
    words: [],
  },
  {
    speakerId: 's1',
    speakerName: 'Bさん',
    start: 5,
    end: 6,
    text: 'よろしくお願いします',
    words: [],
  },
];

describe('verifySummaryEvidence', () => {
  it('会話にある引用だけを、発言の位置・話者・開始時間と一緒に残す（空白・全角半角の違いは無視）', () => {
    const { keyPoints, dropped } = verifySummaryEvidence(
      [
        {
          topic: 'RAG',
          summary: '要点',
          evidence: ['ＲＡＧ の話', '作り話の引用'],
        },
      ],
      utterances,
    );
    expect(keyPoints).toEqual([
      {
        topic: 'RAG',
        summary: '要点',
        evidence: [
          {
            quote: 'ＲＡＧ の話',
            utteranceIndex: 0,
            speakerName: 'Aさん',
            start: 0,
          },
        ],
      },
    ]);
    expect(dropped).toBe(1);
  });

  it('根拠を返さなかった要点は、根拠なしのまま残す', () => {
    const { keyPoints, dropped } = verifySummaryEvidence(
      [{ topic: 'RAG', summary: '要点' }],
      utterances,
    );
    expect(keyPoints).toEqual([{ topic: 'RAG', summary: '要点' }]);
    expect(dropped).toBe(0);
  });

  it('文字列でない引用・空の引用は除く', () => {
    const { keyPoints, dropped } = verifySummaryEvidence(
      [
        {
          topic: 'RAG',
          summary: '要点',
          evidence: [42 as unknown as string, ' '],
        },
      ],
      utterances,
    );
    expect(keyPoints?.[0].evidence).toEqual([]);
    expect(dropped).toBe(2);
  });

  it('要点がない場合は undefined を返す', () => {
    expect(verifySummaryEvidence(undefined, utterances)).toEqual({
      keyPoints: undefined,
      dropped: 0,
    });
  });
});
