import { INestApplication } from '@nestjs/common';
import { API_TOKEN_HEADER, apiTokenMiddleware } from './security/api-token';

/**
 * 待ち受ける前のアプリの設定（トークンの確認・CORS・API のプレフィックス）
 * main.ts とテストで同じ設定を使うため、ここにまとめる
 */
export function configureApp(
  app: INestApplication,
  apiToken: string | null,
): void {
  // アプリの画面以外からの呼び出しを断る（静的配信の音声も対象にするため、ほかより先に登録する）
  if (apiToken) {
    app.use(apiTokenMiddleware(apiToken));
  } else {
    console.warn(
      '[api-token] API_TOKEN がないため、トークンを確かめずに動きます（開発時のみ）',
    );
  }

  // CORSを設定（CORS_ORIGIN環境変数でカンマ区切りで複数オリジン指定可能）
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'tauri://localhost'];
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS not allowed: ${origin}`));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', API_TOKEN_HEADER],
  });

  // APIプレフィックスを設定
  app.setGlobalPrefix('api');
}
