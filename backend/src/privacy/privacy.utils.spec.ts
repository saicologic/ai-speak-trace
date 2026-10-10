import { Transcription } from '../transcription/types/transcription.types';
import { PiiFinding } from './privacy.types';
import {
  maskText,
  maskTranscription,
  toFindings,
  toScanText,
} from './privacy.utils';

const transcription: Transcription = {
  id: 't1',
  audioFileName: 'a.mp3',
  createdAt: '2026-01-01T00:00:00.000Z',
  languageCode: 'ja',
  fullText: '山田太郎です。電話は090-1234-5678です。山田太郎より',
  speakers: [{ id: 's0', name: '山田太郎', color: '#000' }],
  words: [
    { text: '山田太郎', start: 0, end: 1, type: 'word', speakerId: 's0' },
  ],
  utterances: [
    {
      speakerId: 's0',
      speakerName: '山田太郎',
      start: 0,
      end: 1,
      text: '山田太郎です。電話は090-1234-5678です。',
      words: [],
    },
  ],
};

describe('toFindings', () => {
  it('種類と文字列ごとにまとめ、回数を数え、初期値は伏せる', () => {
    const text = '山田太郎です。山田太郎より。090-1234-5678';
    const findings = toFindings(
      [
        { type: 'NAME', match: '山田太郎' },
        { type: 'NAME', match: '山田太郎' },
        { type: 'PHONE', match: '090-1234-5678' },
        { type: 'NAME', match: ' ' },
      ],
      text,
    );
    expect(findings).toEqual([
      { type: 'NAME', label: '氏名', text: '山田太郎', count: 2, mask: true },
      {
        type: 'PHONE',
        label: '電話番号',
        text: '090-1234-5678',
        count: 1,
        mask: true,
      },
    ]);
  });

  it('前回の「伏せない」の選択を引き継ぐ', () => {
    const previous: PiiFinding[] = [
      { type: 'NAME', label: '氏名', text: '加賀谷', count: 3, mask: false },
    ];
    const [finding] = toFindings(
      [{ type: 'NAME', match: '加賀谷' }],
      '加賀谷',
      previous,
    );
    expect(finding.mask).toBe(false);
  });

  it('独自の正規表現（マイナンバー）にも表示名を付ける', () => {
    const [finding] = toFindings(
      [{ type: 'JP_MY_NUMBER', match: '123456789012' }],
      '123456789012',
    );
    expect(finding.label).toBe('マイナンバー');
  });
});

describe('maskText', () => {
  it('伏せると選んだ文字列だけを、長いものから置き換える', () => {
    const findings: PiiFinding[] = [
      { type: 'NAME', label: '氏名', text: '山田', count: 1, mask: true },
      { type: 'NAME', label: '氏名', text: '山田太郎', count: 1, mask: true },
      { type: 'NAME', label: '氏名', text: '加賀谷', count: 1, mask: false },
    ];
    expect(maskText('山田太郎と山田と加賀谷', findings)).toBe(
      '[氏名]と[氏名]と加賀谷',
    );
  });
});

describe('maskTranscription', () => {
  const findings: PiiFinding[] = [
    { type: 'NAME', label: '氏名', text: '山田太郎', count: 2, mask: true },
    {
      type: 'PHONE',
      label: '電話番号',
      text: '090-1234-5678',
      count: 1,
      mask: true,
    },
  ];

  it('本文・話者名・単語を置き換え、元の文字起こしは変更しない', () => {
    const masked = maskTranscription(transcription, findings);
    expect(masked.utterances[0].text).toBe(
      '[氏名]です。電話は[電話番号]です。',
    );
    expect(masked.utterances[0].speakerName).toBe('[氏名]');
    expect(masked.speakers[0].name).toBe('[氏名]');
    expect(masked.words[0].text).toBe('[氏名]');
    expect(masked.fullText).not.toContain('山田太郎');
    expect(transcription.utterances[0].text).toContain('山田太郎');
  });

  it('伏せるものがなければ、そのまま返す', () => {
    const none = findings.map((f) => ({ ...f, mask: false }));
    expect(maskTranscription(transcription, none)).toBe(transcription);
  });
});

describe('toScanText', () => {
  it('話者名付きで1行1発言にする', () => {
    expect(toScanText(transcription)).toBe(
      '山田太郎: 山田太郎です。電話は090-1234-5678です。',
    );
  });
});
