import {
  chunkText,
  splitIntoSentences,
  truncateToBytes,
  CHUNK_TARGET_SIZE,
  CHUNK_MIN_SIZE,
} from './document.utils';

describe('splitIntoSentences', () => {
  it('句点で文を分割する', () => {
    const result = splitIntoSentences('これは文です。次の文です。');
    expect(result).toEqual(['これは文です。', '次の文です。']);
  });

  it('感嘆符・疑問符でも分割する', () => {
    const result = splitIntoSentences('本当ですか？はい！そうです。');
    expect(result).toEqual(['本当ですか？', 'はい！', 'そうです。']);
  });

  it('半角の感嘆符・疑問符でも分割する', () => {
    const result = splitIntoSentences('Really?Yes!OK。');
    expect(result).toEqual(['Really?', 'Yes!', 'OK。']);
  });

  it('句読点がない場合は1つの文として返す', () => {
    const result = splitIntoSentences('句読点のないテキスト');
    expect(result).toEqual(['句読点のないテキスト']);
  });

  it('空文字列の場合は空配列を返す', () => {
    expect(splitIntoSentences('')).toEqual([]);
  });
});

describe('truncateToBytes', () => {
  it('バ���ト数以内のテキストはそのまま返す', () => {
    expect(truncateToBytes('abc', 10)).toBe('abc');
  });

  it('ASCII文字を正しく切り詰める', () => {
    expect(truncateToBytes('abcdef', 3)).toBe('abc');
  });

  it('日本語テキストをバイト境界で安全に切り詰める', () => {
    // 「あ」はUTF-8で3バイト
    const result = truncateToBytes('あいう', 6); // 2文字分
    expect(result).toBe('あい');
  });

  it('マルチバイト文字の途中で切れた場合に不正文字を除去する', () => {
    // 「あ」(3バイト) + 「い」の途中(1-2バイト) → 「い」の途中は\uFFFDになり除去
    const result = truncateToBytes('あい', 4);
    expect(result).toBe('あ');
    expect(result).not.toContain('\uFFFD');
  });

  it('空文字列を処理できる', () => {
    expect(truncateToBytes('', 10)).toBe('');
  });

  it('ちょうどのバイト数ならそのまま返す', () => {
    expect(truncateToBytes('abc', 3)).toBe('abc');
  });
});

describe('chunkText', () => {
  it('空文字列から空のチャンクリストを返す', () => {
    expect(chunkText('doc-1', '')).toEqual([]);
  });

  it('短いテキストは1つのチャンクになる', () => {
    const text =
      'これは短いテキストです。テスト用の文章です。これで50文字を超えるようにします。十分な長さがあります。';
    const result = chunkText('doc-1', text);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc-1_0');
    expect(result[0].documentId).toBe('doc-1');
    expect(result[0].chunkIndex).toBe(0);
    expect(result[0].text).toBe(text);
  });

  it('CHUNK_MIN_SIZE未満のテキストはチャンクに含めない', () => {
    const shortText = 'あ'.repeat(CHUNK_MIN_SIZE - 1);
    const result = chunkText('doc-1', shortText);
    expect(result).toEqual([]);
  });

  it('複数段落を適切にチャンクに分割する', () => {
    // 各段落が200文字程度（500文字以内に収まる）
    const paragraph = 'あ'.repeat(200);
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const result = chunkText('doc-1', text);
    expect(result.length).toBeGreaterThan(1);
    // 各チャンクのIDがインクリメントされている
    result.forEach((chunk, i) => {
      expect(chunk.id).toBe(`doc-1_${i}`);
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it('長い段落を文単位で分割する', () => {
    // CHUNK_TARGET_SIZE（500文字）を超える1段落
    const sentence = 'これはテスト文です。'; // 9文字
    const longParagraph = sentence.repeat(60); // 540文字
    const result = chunkText('doc-1', longParagraph);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // 各チャンクがTARGET_SIZEを大きく超えないこ��
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_TARGET_SIZE + 200);
    }
  });

  it('短い段落の後に長い段落が来る場合、短い段落をフラッシュしてから文分割する', () => {
    // currentChunkに短い段落がある状態で、長い段落が来るケース（L27-28カバー）
    const shortParagraph = 'あ'.repeat(100);
    const longParagraph = 'これはテスト用の文です。'.repeat(50); // 600文字超
    const text = `${shortParagraph}\n\n${longParagraph}`;
    const result = chunkText('doc-1', text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // 最初のチャンクが短い段落
    expect(result[0].text).toBe(shortParagraph);
  });

  it('チャンクIDがdocumentId_indexの形式になる', () => {
    const text = 'あ'.repeat(300) + '\n\n' + 'い'.repeat(300);
    const result = chunkText('my-doc', text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].documentId).toBe('my-doc');
    expect(result[0].id).toMatch(/^my-doc_\d+$/);
  });
});
