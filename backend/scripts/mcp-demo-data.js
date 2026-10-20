/**
 * MCP サーバーの確認用に、架空の会話だけでデータのフォルダを作る
 * （実在の人・会話は含めない。端末の実データは読まない）
 *
 * 使い方: node scripts/mcp-demo-data.js <作るフォルダ>
 * 先に npm run mcp:build でビルドしておく（GiNZA のキャッシュのハッシュに dist の関数を使う）
 */
const fs = require('fs');
const path = require('path');
const {
  hashTexts,
  stripSoundTags,
} = require('../dist/ginza/ginza-keywords.utils.js');

const dir = process.argv[2];
if (!dir) {
  console.error('使い方: node scripts/mcp-demo-data.js <作るフォルダ>');
  process.exit(1);
}

// 個人情報チェックは、文字起こしの保存より後に行ったことにする
const scannedAt = new Date(Date.now() + 60_000).toISOString();

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** 架空の会話を書く（フォルダ名は音声ファイル名から作られる想定で、名前を含める） */
function writeTranscription(id, createdAt, lines) {
  const names = { speaker_0: 'Aさん', speaker_1: 'Bさん' };
  const transcription = {
    id,
    audioFileName: `${id}.mp3`,
    createdAt,
    languageCode: 'ja',
    fullText: lines.map(([, text]) => text).join(' '),
    speakers: [
      { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
      { id: 'speaker_1', name: 'Bさん', color: '#10B981' },
    ],
    words: [],
    utterances: lines.map(([speakerId, text], i) => ({
      speakerId,
      speakerName: names[speakerId],
      start: i * 75,
      end: i * 75 + 70,
      text,
      words: [],
    })),
  };
  writeJson(
    path.join(dir, 'transcriptions', id, 'transcription.json'),
    transcription,
  );
  return transcription;
}

function writeScan(id, findings) {
  writeJson(path.join(dir, 'privacy-scans', `${id}.json`), {
    transcriptionId: id,
    scannedAt,
    guardrailId: 'demo',
    guardrailVersion: '1',
    findings,
  });
}

// このスクリプトが作ったフォルダの目印（ほかのフォルダを消さないため）
const MARKER = path.join(dir, '.mcp-demo-data');
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
  if (!fs.existsSync(MARKER)) {
    console.error(
      `空でないフォルダには作れません（このスクリプトが作ったフォルダではありません）: ${dir}`,
    );
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(MARKER, '');

// チェック済み: 「伏せる」を選んだ名前と、連絡先を含む
const checked = writeTranscription(
  '架空太郎さんとの雑談',
  '2026-03-01T10:00:00.000Z',
  [
    ['speaker_0', '今日は架空太郎さんと型チェックの話をします。'],
    ['speaker_1', 'TypeScript の型チェックは便利ですね。'],
    ['speaker_0', '連絡先は 090-0000-0000 か demo@example.com です。'],
    ['speaker_1', '型チェックを CI で動かすと安心です。'],
    ['speaker_0', '次回は架空太郎さんとテストの話をしましょう。'],
  ],
);
writeScan(checked.id, [
  {
    type: 'NAME',
    label: '氏名',
    text: '架空太郎',
    count: 2,
    mask: true,
    needsReview: false,
  },
]);
// GiNZA のキャッシュ（語は [比べるための形（小文字）, 表記] の組）
writeJson(path.join(dir, 'ginza-keywords', `${checked.id}.json`), {
  engineHash: 'demo',
  textsHash: hashTexts(checked.utterances.map((u) => stripSoundTags(u.text))),
  terms: [
    [
      ['架空太郎', '架空太郎'],
      ['型チェック', '型チェック'],
    ],
    [
      ['typescript', 'TypeScript'],
      ['型チェック', '型チェック'],
    ],
    [['連絡先', '連絡先']],
    [
      ['型チェック', '型チェック'],
      ['ci', 'CI'],
    ],
    [
      ['架空太郎', '架空太郎'],
      ['テスト', 'テスト'],
    ],
  ],
});

// 未チェック: 返さない
writeTranscription('未チェックの会話', '2026-02-01T10:00:00.000Z', [
  ['speaker_0', '型チェックの話（未チェック）'],
  ['speaker_1', 'はい'],
]);

// 要確認が残る: 返さない
const review = writeTranscription('要確認の会話', '2026-01-01T10:00:00.000Z', [
  ['speaker_0', '型チェックの話（要確認）'],
  ['speaker_1', 'はい'],
]);
writeScan(review.id, [
  {
    type: 'NAME',
    label: '氏名',
    text: '架空花子',
    count: 1,
    mask: false,
    needsReview: true,
  },
]);

console.log(`架空の会話を作りました: ${dir}`);
