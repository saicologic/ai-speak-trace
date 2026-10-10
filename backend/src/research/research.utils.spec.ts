import type Anthropic from '@anthropic-ai/sdk';
import { Transcription } from '../transcription/types/transcription.types';
import {
  checkPersonalData,
  collectWebSources,
  countOccurrences,
  isOfficial,
  normalizeDomain,
  toReportSegments,
  toTranscriptDocument,
  verifyQuotes,
} from './research.utils';

function transcription(id: string, texts: [string, string][]): Transcription {
  return {
    id,
    audioFileName: `${id}.mp3`,
    utterances: texts.map(([speakerName, text]) => ({
      speakerId: speakerName,
      speakerName,
      start: 0,
      end: 1,
      text,
      words: [],
    })),
  } as unknown as Transcription;
}

const t1 = transcription('t1', [
  ['Aさん', 'ハーネスエンジニアリングの話をします'],
  ['Bさん', ''],
  ['Bさん', 'エージェントのハーネスが大事です'],
]);
const t2 = transcription('t2', [['Aさん', 'ハーネス を 評価します']]);

describe('research.utils', () => {
  it('会話を話者付きの1行1発言にし、空の発言を除く', () => {
    expect(toTranscriptDocument(t1)).toBe(
      'Aさん: ハーネスエンジニアリングの話をします\nBさん: エージェントのハーネスが大事です',
    );
  });

  it('複数の会話での出現回数を、空白の違いを無視して数える', () => {
    expect(countOccurrences([t1, t2], 'ハーネス')).toBe(3);
    expect(countOccurrences([t1, t2], '存在しない語')).toBe(0);
    expect(countOccurrences([t1], '  ')).toBe(0);
  });

  it('実際の発言に含まれる引用だけを残し、話者を付ける', () => {
    expect(
      verifyQuotes(
        ['ハーネスが大事', '作り話の引用', 'ハーネス を評価'],
        [t1, t2],
      ),
    ).toEqual([
      { transcriptionId: 't1', speakerName: 'Bさん', text: 'ハーネスが大事' },
      { transcriptionId: 't2', speakerName: 'Aさん', text: 'ハーネス を評価' },
    ]);
  });

  it('ドメイン指定をそろえ、サブドメインも公式サイトとみなす', () => {
    expect(normalizeDomain(' https://www.Anthropic.com/news ')).toBe(
      'anthropic.com',
    );
    expect(isOfficial('https://docs.anthropic.com/x', ['anthropic.com'])).toBe(
      true,
    );
    expect(isOfficial('https://notanthropic.com/x', ['anthropic.com'])).toBe(
      false,
    );
    expect(isOfficial('不正なURL', ['anthropic.com'])).toBe(false);
  });

  it('Web検索の結果と、回答に引用された抜粋を集める', () => {
    const content = [
      {
        type: 'web_search_tool_result',
        content: [
          { url: 'https://docs.anthropic.com/a', title: '公式A' },
          { url: 'https://blog.example.com/b', title: 'ブログB' },
        ],
      },
      {
        type: 'text',
        text: '要点',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://docs.anthropic.com/a',
            title: '公式A',
            cited_text: ' 抜粋1 ',
          },
          {
            type: 'web_search_result_location',
            url: 'https://docs.anthropic.com/a',
            title: '公式A',
            cited_text: '抜粋1',
          },
        ],
      },
    ] as unknown as Anthropic.ContentBlock[];
    expect(collectWebSources(content, ['anthropic.com'])).toEqual([
      {
        url: 'https://docs.anthropic.com/a',
        title: '公式A',
        domain: 'docs.anthropic.com',
        official: true,
        excerpts: ['抜粋1'],
      },
      {
        url: 'https://blog.example.com/b',
        title: 'ブログB',
        domain: 'blog.example.com',
        official: false,
        excerpts: [],
      },
    ]);
  });

  it('Citations の document_index を、渡した文書の情報源に対応づける', () => {
    const content = [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: '## 見出し\n', citations: null },
      {
        type: 'text',
        text: '会話ではこう語られた。',
        citations: [
          { type: 'char_location', document_index: 0, cited_text: '原文' },
          { type: 'char_location', document_index: 1, cited_text: '公式' },
          { type: 'char_location', document_index: 9, cited_text: '範囲外' },
        ],
      },
    ] as unknown as Anthropic.ContentBlock[];
    expect(
      toReportSegments(content, [
        { sourceKind: 'conversation', sourceId: 't1', title: 't1.mp3' },
        {
          sourceKind: 'web',
          sourceId: 'https://a',
          title: 'A',
          official: true,
        },
      ]),
    ).toEqual([
      { text: '## 見出し\n', citations: [] },
      {
        text: '会話ではこう語られた。',
        citations: [
          {
            sourceKind: 'conversation',
            sourceId: 't1',
            title: 't1.mp3',
            citedText: '原文',
          },
          {
            sourceKind: 'web',
            sourceId: 'https://a',
            title: 'A',
            citedText: '公式',
            official: true,
          },
        ],
      },
    ]);
  });

  it('連絡先などの個人情報を検出する', () => {
    expect(
      checkPersonalData([{ text: '問題なし', citations: [] }]).passed,
    ).toBe(true);
    const found = checkPersonalData([
      { text: '連絡先は taro@example.com、電話 090-1234-5678', citations: [] },
    ]);
    expect(found.passed).toBe(false);
    expect(found.detail).toContain('メールアドレス');
    expect(found.detail).toContain('電話番号');
  });
});
