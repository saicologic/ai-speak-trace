import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** トークンを付けるヘッダー */
export const API_TOKEN_HEADER = 'x-api-token';

/** ヘッダーを付けられない <audio src> で使う、URL のクエリのトークン */
export const API_TOKEN_QUERY = 'token';

/**
 * クエリのトークンを受け付けるパス（<audio src> で読む音声だけ）
 * - /audio/...: 保存した音声ファイル（静的配信）
 * - /api/transcribe/jobs/:jobId/chunks/:chunkIndex/audio: 分割した部分の音声
 * - /api/podcast-files/:fileName/stream: Podcast の音声
 */
const QUERY_TOKEN_PATHS = [
  /^\/audio\//,
  /^\/api\/transcribe\/jobs\/[^/]+\/chunks\/\d+\/audio$/,
  /^\/api\/podcast-files\/[^/]+\/stream$/,
];

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** リクエストに正しいトークンが付いているか */
export function hasValidToken(
  req: Pick<Request, 'method' | 'path' | 'headers' | 'query'>,
  expected: string,
): boolean {
  if (sameToken(req.headers[API_TOKEN_HEADER], expected)) return true;
  return (
    (req.method === 'GET' || req.method === 'HEAD') &&
    QUERY_TOKEN_PATHS.some((p) => p.test(req.path)) &&
    sameToken(req.query[API_TOKEN_QUERY], expected)
  );
}

/**
 * sidecar の API をアプリの画面だけから使えるようにするミドルウェア
 * 127.0.0.1 で待ち受けていても、同じ Mac の別のプロセス（AI エージェントのコマンドなど）からは呼べるため、
 * Tauri が起動のたびに作るトークン（環境変数 API_TOKEN）がないリクエストを断る。
 * CORS の事前確認（OPTIONS）はトークンを付けられないため通す（CORS の設定で接続元を確かめる）。
 */
export function apiTokenMiddleware(expected: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'OPTIONS' || hasValidToken(req, expected)) {
      next();
      return;
    }
    res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
  };
}

/**
 * トークンを求めるか
 * - API_TOKEN があれば求める（アプリから起動した sidecar）
 * - アプリにまとめた sidecar（pkg）で API_TOKEN がなければ、起動を止める（トークンなしで動かさない）
 * - 開発時（npm run start:dev・ブラウザでの確認）は API_TOKEN がなければ求めない
 */
export function resolveApiToken(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
): string | null {
  const token = env.API_TOKEN?.trim();
  if (token) return token;
  if (packaged) {
    throw new Error('API_TOKEN がありません。アプリから起動してください');
  }
  return null;
}
