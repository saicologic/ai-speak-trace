/**
 * ブランチ名からバージョンを抽出して src-tauri/tauri.conf.json を更新するスクリプト。
 * release/vX.Y.Z ブランチの場合のみ更新し、それ以外はスキップする。
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const branch = execSync('git branch --show-current').toString().trim();
const match = branch.match(/^release\/v(.+)$/);

if (match) {
  const version = match[1];
  const filePath = 'src-tauri/tauri.conf.json';
  const json = JSON.parse(readFileSync(filePath, 'utf-8'));
  json.version = version;
  writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
  console.log(`[set-version] version → ${version}`);
} else {
  console.log(`[set-version] ブランチ "${branch}" は release/* でないためスキップ`);
}
