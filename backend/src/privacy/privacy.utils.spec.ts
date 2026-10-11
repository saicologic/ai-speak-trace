import { Transcription } from '../transcription/types/transcription.types';
import { PiiFinding } from './privacy.types';
import {
  isIgnoredPii,
  maskText,
  maskTranscription,
  toFindings,
  toScanText,
  withoutIgnoredPii,
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
  it('種類と文字列ごとにまとめて回数を数え、氏名は伏せずに要確認、連絡先は伏せる', () => {
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
      {
        type: 'NAME',
        label: '氏名',
        text: '山田太郎',
        count: 2,
        mask: false,
        needsReview: true,
      },
      {
        type: 'PHONE',
        label: '電話番号',
        text: '090-1234-5678',
        count: 1,
        mask: true,
        needsReview: false,
      },
    ]);
  });

  it('前回の選択と確認済みの状態を引き継ぐ', () => {
    const previous: PiiFinding[] = [
      {
        type: 'NAME',
        label: '氏名',
        text: '山田',
        count: 3,
        mask: true,
        needsReview: false,
      },
    ];
    const [finding] = toFindings(
      [{ type: 'NAME', match: '山田' }],
      '山田',
      previous,
    );
    expect(finding).toMatchObject({ mask: true, needsReview: false });
  });

  it('独自の正規表現（マイナンバー）にも表示名を付ける', () => {
    const [finding] = toFindings(
      [{ type: 'JP_MY_NUMBER', match: '123456789012' }],
      '123456789012',
    );
    expect(finding).toMatchObject({
      label: 'マイナンバー',
      mask: true,
      needsReview: false,
    });
  });
});

describe('maskText', () => {
  it('伏せると選んだ文字列だけを、長いものから置き換える', () => {
    const findings: PiiFinding[] = [
      {
        type: 'NAME',
        label: '氏名',
        text: '山田',
        count: 1,
        mask: true,
        needsReview: false,
      },
      {
        type: 'NAME',
        label: '氏名',
        text: '山田太郎',
        count: 1,
        mask: true,
        needsReview: false,
      },
      {
        type: 'NAME',
        label: '氏名',
        text: '加賀谷',
        count: 1,
        mask: false,
        needsReview: false,
      },
    ];
    expect(maskText('山田太郎と山田と加賀谷', findings)).toBe(
      '[氏名]と[氏名]と加賀谷',
    );
  });
});

describe('maskTranscription', () => {
  const findings: PiiFinding[] = [
    {
      type: 'NAME',
      label: '氏名',
      text: '山田太郎',
      count: 2,
      mask: true,
      needsReview: false,
    },
    {
      type: 'PHONE',
      label: '電話番号',
      text: '090-1234-5678',
      count: 1,
      mask: true,
      needsReview: false,
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

describe('isIgnoredPii', () => {
  it('ユーザー名は個人情報として扱わない', () => {
    expect(isIgnoredPii('USERNAME', 'ChatGPT')).toBe(true);
    expect(isIgnoredPii('USERNAME', 'Anthropic')).toBe(true);
  });

  it('国名だけの住所は個人情報として扱わない', () => {
    expect(isIgnoredPii('ADDRESS', '日本')).toBe(true);
    expect(isIgnoredPii('ADDRESS', 'アメリカ')).toBe(true);
    expect(isIgnoredPii('ADDRESS', ' Japan ')).toBe(true);
  });

  it('会社名・製品名だけの氏名は個人情報として扱わない', () => {
    expect(isIgnoredPii('NAME', 'Claude')).toBe(true);
    expect(isIgnoredPii('NAME', 'Claude Code')).toBe(true);
    expect(isIgnoredPii('NAME', "O'Reilly")).toBe(true);
    // アポストロフィの違いと大文字小文字は無視する
    expect(isIgnoredPii('NAME', 'O’Reilly')).toBe(true);
    expect(isIgnoredPii('NAME', 'claude code')).toBe(true);
  });

  it('会社名・製品名を含む人名や、公開されている人の名前は、これまでどおり扱う', () => {
    expect(isIgnoredPii('NAME', 'Claude太郎')).toBe(false);
    expect(isIgnoredPii('NAME', 'Chip Huyen')).toBe(false);
    expect(isIgnoredPii('NAME', '金井')).toBe(false);
  });

  it('番地や市区町村を含む住所と、氏名・連絡先はこれまでどおり扱う', () => {
    expect(isIgnoredPii('ADDRESS', '東京都千代田区1-1')).toBe(false);
    expect(isIgnoredPii('ADDRESS', '日本橋')).toBe(false);
    expect(isIgnoredPii('NAME', '日本')).toBe(false);
    expect(isIgnoredPii('EMAIL', 'x@example.com')).toBe(false);
  });
});

describe('withoutIgnoredPii', () => {
  const finding = (type: string, text: string, mask: boolean): PiiFinding => ({
    type,
    label: type,
    text,
    count: 1,
    mask,
    needsReview: !mask,
  });

  it('保存済みの検出結果から、ユーザー名と国名だけの住所を除く', () => {
    const result = withoutIgnoredPii([
      finding('USERNAME', 'Code', false),
      finding('ADDRESS', '日本', false),
      finding('NAME', '山田', false),
    ]);
    expect(result.map((f) => f.text)).toEqual(['山田']);
  });

  it('利用者が「伏せる」を選んだものは残す', () => {
    const result = withoutIgnoredPii([finding('USERNAME', 'yamada01', true)]);
    expect(result.map((f) => f.text)).toEqual(['yamada01']);
  });
});
