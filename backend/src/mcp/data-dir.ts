import * as os from 'os';
import * as path from 'path';

/** デスクトップアプリのデータの保存先（src-tauri の identifier と同じ） */
export const DEFAULT_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'io.github.saicologic.ai-speak-trace',
  'data',
);

/** 読み込むデータのフォルダ（環境変数 DATA_DIR で上書きできる） */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR);
}
