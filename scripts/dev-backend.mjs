/**
 * 開発時バックエンド起動スクリプト
 *
 * NestJS を nest start --watch で起動し、stdout から "PORT=xxxxx" を検出したら
 * ルートの .backend-port ファイルへポート番号を書き込む。
 * Vite の設定はこのファイルを読んで動的にプロキシを設定する。
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const portFile = resolve(rootDir, '.backend-port');

const child = spawn('npm', ['run', 'start:dev'], {
  cwd: resolve(rootDir, 'backend'),
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: true,
});

child.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);

  // "PORT=xxxxx" を検出してファイルへ書き込む
  const match = text.match(/PORT=(\d+)/);
  if (match) {
    const port = match[1];
    writeFileSync(portFile, port, 'utf-8');
    console.log(`[dev-backend] ポート確定: ${port} → .backend-port に書き込みました`);
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

// 親プロセス終了時に子プロセスもkill
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
