/**
 * 開発用起動スクリプト
 *
 * 1. .backend-port を削除してリセット
 * 2. バックエンド (NestJS) を起動し "PORT=xxxxx" を検出して .backend-port へ書き込む
 * 3. ポートが確定したら tauri dev を起動
 *    （tauri dev は beforeDevCommand で vite を起動し、vite が .backend-port を読んでproxyを設定）
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const portFile = resolve(rootDir, '.backend-port');

// 起動前に古いポートファイルを削除
if (existsSync(portFile)) {
  unlinkSync(portFile);
}

// ポート5173も使用中なら解放
try {
  const pids = execSync('lsof -ti:5173 2>/dev/null').toString().trim();
  if (pids) {
    pids.split('\n').forEach((pid) => {
      try { process.kill(Number(pid), 'SIGKILL'); } catch {}
    });
  }
} catch {}

console.log('[dev] バックエンドを起動します...');

// バックエンドを起動
const backend = spawn('npm', ['run', 'start:dev'], {
  cwd: resolve(rootDir, 'backend'),
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: true,
});

backend.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);

  // "PORT=xxxxx" を検出したら .backend-port に書き込み、Tauriを起動
  const match = text.match(/PORT=(\d+)/);
  if (match && !existsSync(portFile)) {
    const port = match[1];
    writeFileSync(portFile, port, 'utf-8');
    console.log(`[dev] ポート確定: ${port} → tauri dev を起動します`);

    // tauri dev を起動（Vite は tauri.conf.json の beforeDevCommand で起動される）
    const tauri = spawn('npx', ['tauri', 'dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });

    tauri.on('exit', (code) => {
      backend.kill();
      process.exit(code ?? 0);
    });

    process.on('SIGTERM', () => { tauri.kill('SIGTERM'); backend.kill('SIGTERM'); });
    process.on('SIGINT', () => { tauri.kill('SIGINT'); backend.kill('SIGINT'); });
  }
});

backend.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[dev] バックエンドが異常終了しました (code=${code})`);
    process.exit(code);
  }
});
