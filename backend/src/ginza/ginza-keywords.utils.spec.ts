import {
  countRegexKeywords,
  hashTexts,
  normalizeTerm,
  rankKeywords,
  stripSoundTags,
} from './ginza-keywords.utils';

describe('stripSoundTags', () => {
  it('[笑い] のような音のタグを取り除く', () => {
    expect(stripSoundTags('[タイピング]お世話になります。[笑い]はい')).toBe(
      'お世話になります。はい',
    );
  });
});

describe('normalizeTerm', () => {
  it('全角・半角と大文字・小文字をそろえる', () => {
    expect(normalizeTerm('ＬＬＭ')).toBe('llm');
  });
});

describe('hashTexts', () => {
  it('同じ一覧は同じハッシュ、違う一覧は違うハッシュになる', () => {
    expect(hashTexts(['a', 'b'])).toBe(hashTexts(['a', 'b']));
    expect(hashTexts(['a', 'b'])).not.toBe(hashTexts(['ab']));
  });
});

describe('countRegexKeywords', () => {
  it('標準のキーワード抽出と同じく、長い複合語を優先して数える', () => {
    const counts = countRegexKeywords('AIエンジニアリングとLLMとLLM');
    expect(counts.get('AIエンジニアリング')).toBe(1);
    expect(counts.get('AI')).toBeUndefined();
    expect(counts.get('LLM')).toBe(2);
  });
});

describe('rankKeywords', () => {
  it('GiNZA の語を数え、いちばん多い表記で返す', () => {
    const result = rankKeywords(
      [
        [['評価', '評価']],
        [
          ['評価', '評価'],
          ['設計', '設計'],
        ],
      ],
      '',
      [],
    );
    expect(result).toEqual([
      { text: '評価', count: 2 },
      { text: '設計', count: 1 },
    ]);
  });

  it('英字だけの語は標準の抽出から足し、GiNZA と重なる語は足さない', () => {
    const result = rankKeywords([[['llm', 'LLM']]], 'FDE と LLM と FDE', []);
    expect(result).toEqual([
      { text: 'FDE', count: 2 },
      { text: 'LLM', count: 1 },
    ]);
  });

  it('英字以外の標準の語（カタカナなど）は足さない', () => {
    const result = rankKeywords([], 'エンジニア向けのテックリード', []);
    expect(result).toEqual([]);
  });

  it('回数の多い順に並べ、すべての会話に出てくる語は除く', () => {
    const result = rankKeywords(
      [
        [
          ['運用', '運用'],
          ['運用', '運用'],
          ['運用', '運用'],
          ['品質', '品質'],
          ['検証', '検証'],
          ['検証', '検証'],
        ],
      ],
      '',
      ['運用の話', '運用と検証'],
    );
    // 運用はすべての会話に出てくるため除く。検証はほかの会話にも出てくるが、回数が多いため品質より上
    expect(result).toEqual([
      { text: '検証', count: 2 },
      { text: '品質', count: 1 },
    ]);
  });

  it('同じ回数なら、ほかの会話に出てこない語を先にする', () => {
    const result = rankKeywords(
      [
        [
          ['検証', '検証'],
          ['品質', '品質'],
        ],
      ],
      '',
      ['検証の話', 'ほかの話'],
    );
    expect(result.map((k) => k.text)).toEqual(['品質', '検証']);
  });

  it('ほかの会話は音のタグを除き、空白を詰めて比べる', () => {
    const result = rankKeywords([[['claude code', 'Claude Code']]], '', [
      '[笑い]ClaudeCode を使う',
      'ほかの話',
    ]);
    expect(result).toEqual([{ text: 'Claude Code', count: 1 }]);
    // 2件中1件に出てくるため、出てこない語より順位が下になる
    const both = rankKeywords(
      [
        [
          ['claude code', 'Claude Code'],
          ['品質', '品質'],
        ],
      ],
      '',
      ['ClaudeCode を使う', 'ほかの話'],
    );
    expect(both.map((k) => k.text)).toEqual(['品質', 'Claude Code']);
  });

  it('会話によく出てくる一般的な語は除く', () => {
    const result = rankKeywords(
      [
        [
          ['会社', '会社'],
          ['会社', '会社'],
          ['基本的', '基本的'],
          ['ご提案', 'ご提案'],
          ['お伺い', 'お伺い'],
          ['設計', '設計'],
        ],
      ],
      '',
      [],
    );
    expect(result).toEqual([{ text: '設計', count: 1 }]);
  });
});
