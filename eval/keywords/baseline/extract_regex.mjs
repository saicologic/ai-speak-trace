// 今のアプリのキーワード抽出（frontend/src/utils/keywords.ts の extractKeywords）を
// そのまま実行して、結果を JSON で標準出力に書き出す。
// Python で書き直すと結果がずれるため、元の TypeScript を Node の型除去で直接読み込む。
//
// 使い方: node baseline/extract_regex.mjs <keywords.ts のパス> < 入力.json
// 入力:  [{ "id": "...", "text": "..." }, ...]
// 出力:  [{ "id": "...", "keywords": [{ "text": "...", "count": 1 }], "elapsedMs": 1.2 }, ...]

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const [, , keywordsTsPath] = process.argv;
if (!keywordsTsPath) {
  console.error('keywords.ts のパスを指定してください');
  process.exit(1);
}

const { extractKeywords } = await import(pathToFileURL(keywordsTsPath).href);
const docs = JSON.parse(readFileSync(0, 'utf-8'));

const results = docs.map(({ id, text }) => {
  const start = performance.now();
  const keywords = extractKeywords(text);
  const elapsedMs = performance.now() - start;
  return { id, keywords, elapsedMs };
});

process.stdout.write(JSON.stringify(results));
