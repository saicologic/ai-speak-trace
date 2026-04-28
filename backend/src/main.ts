import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SettingsService } from './settings/settings.service';

// pkg --jitless 環境では DOMMatrix 等のグローバルが未定義になるためポリフィル
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {};
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as Record<string, unknown>).ImageData = class ImageData {};
}
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as Record<string, unknown>).Path2D = class Path2D {};
}

// NestJS 起動前に settings.json の値を process.env にマージ
SettingsService.loadSettingsIntoEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORSを設定（CORS_ORIGIN環境変数でカンマ区切りで複数オリジン指定可能）
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'tauri://localhost'];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS not allowed: ${origin}`));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  // APIプレフィックスを設定
  app.setGlobalPrefix('api');

  // ポート0を指定してOSに空きポートを自動割り当てさせる
  await app.listen(0, '127.0.0.1');

  // 実際に割り当てられたポートを取得してstdoutへ出力
  // Rust(lib.rs)がこの行をパースしてフロントエンドへ通知する
  const url = await app.getUrl();
  const port = new URL(url).port;
  console.log(`PORT=${port}`);
}
bootstrap();
