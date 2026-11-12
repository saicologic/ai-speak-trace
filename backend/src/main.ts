import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SettingsService } from './settings/settings.service';
import { configureApp } from './app-setup';
import { resolveApiToken } from './security/api-token';
import {
  createEgressFileLogger,
  installEgressGuard,
} from './security/egress-guard';
import * as path from 'path';

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
// API キーはキーチェーンから読み込む（macOS のみ。settings.json に残っているキーはキーチェーンに移す）
SettingsService.loadApiKeysFromKeychain();
// 外への通信を、アプリが使う API の宛先（HTTPS）だけに絞り、データのフォルダの logs/network.jsonl に記録する
// （DATA_DIR は settings.json から読むため、その後で入れる）
installEgressGuard({
  log: createEgressFileLogger(
    path.join(process.env.DATA_DIR || './data', 'logs', 'network.jsonl'),
  ),
});

async function bootstrap() {
  // pkg でまとめた sidecar では process.pkg がある
  const packaged = 'pkg' in process;
  const apiToken = resolveApiToken(process.env, packaged);
  const app = await NestFactory.create(AppModule);

  configureApp(app, apiToken);

  // ポート0を指定してOSに空きポートを自動割り当てさせる
  await app.listen(0, '127.0.0.1');

  // 実際に割り当てられたポートを取得してstdoutへ出力
  // Rust(lib.rs)がこの行をパースしてフロントエンドへ通知する
  const url = await app.getUrl();
  const port = new URL(url).port;
  console.log(`PORT=${port}`);
}
bootstrap();
