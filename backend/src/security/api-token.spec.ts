import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../app-setup';
import { AppModule } from '../app.module';
import { hasValidToken, resolveApiToken } from './api-token';

const TOKEN = 'a'.repeat(64);

function req(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  return { method, path, headers, query } as Parameters<
    typeof hasValidToken
  >[0];
}

describe('hasValidToken', () => {
  it('ヘッダーのトークンが一致すれば通す', () => {
    expect(
      hasValidToken(
        req('POST', '/api/transcribe', { 'x-api-token': TOKEN }),
        TOKEN,
      ),
    ).toBe(true);
  });

  it('トークンがない・違う・長さが違うときは断る', () => {
    expect(hasValidToken(req('GET', '/api/transcriptions'), TOKEN)).toBe(false);
    expect(
      hasValidToken(
        req('GET', '/api/transcriptions', { 'x-api-token': 'b'.repeat(64) }),
        TOKEN,
      ),
    ).toBe(false);
    expect(
      hasValidToken(
        req('GET', '/api/transcriptions', { 'x-api-token': 'a' }),
        TOKEN,
      ),
    ).toBe(false);
  });

  it('クエリのトークンは、<audio src> で読む音声の GET だけ受け付ける', () => {
    const q = { token: TOKEN };
    expect(hasValidToken(req('GET', '/audio/a.mp3', {}, q), TOKEN)).toBe(true);
    expect(
      hasValidToken(
        req('GET', '/api/transcribe/jobs/j1/chunks/3/audio', {}, q),
        TOKEN,
      ),
    ).toBe(true);
    expect(
      hasValidToken(
        req('GET', '/api/podcast-files/x.mp3/stream', {}, q),
        TOKEN,
      ),
    ).toBe(true);
    // 音声以外・GET 以外では受け付けない
    expect(hasValidToken(req('GET', '/api/transcriptions', {}, q), TOKEN)).toBe(
      false,
    );
    expect(hasValidToken(req('DELETE', '/audio/a.mp3', {}, q), TOKEN)).toBe(
      false,
    );
  });
});

describe('resolveApiToken', () => {
  it('API_TOKEN があれば使う', () => {
    expect(resolveApiToken({ API_TOKEN: ` ${TOKEN} ` }, true)).toBe(TOKEN);
  });

  it('アプリにまとめた sidecar で API_TOKEN がなければ、起動を止める', () => {
    expect(() => resolveApiToken({}, true)).toThrow('API_TOKEN');
  });

  it('開発時は API_TOKEN がなければ求めない', () => {
    expect(resolveApiToken({}, false)).toBeNull();
  });
});

/** Express に登録されたルート（メソッドとパス）をすべて取り出す */
function registeredRoutes(app: INestApplication): [string, string][] {
  const express = app.getHttpAdapter().getInstance() as Express & {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = (express.router ?? express._router)?.stack ?? [];
  const routes: [string, string][] = [];
  for (const layer of stack as {
    route?: { path: string; methods: Record<string, boolean> };
  }[]) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push([method, layer.route.path]);
    }
  }
  return routes;
}

describe('アプリ全体（configureApp）', () => {
  let app: INestApplication;
  let dataDir: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'api-token-'));
    mkdirSync(join(dataDir, 'audio'), { recursive: true });
    writeFileSync(join(dataDir, 'audio', 'a.mp3'), 'x');
    process.env.DATA_DIR = dataDir;
    process.env.SETTINGS_FILE = join(dataDir, 'settings.json');
    process.env.SECRET_STORE = 'file';
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app, TOKEN);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
    process.env = saved;
  });

  it('登録されたすべての API は、トークンがないと 401 を返す', async () => {
    const routes = registeredRoutes(app);
    expect(routes.length).toBeGreaterThan(30);
    const server = app.getHttpServer() as App;
    for (const [method, path] of routes) {
      const url = path.replace(/:[^/]+/g, 'x');
      const res = await (
        request(server) as unknown as Record<
          string,
          (url: string) => request.Test
        >
      )[method](url);
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  it('正しいトークンがあれば、API を呼べる', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api')
      .set('x-api-token', TOKEN);
    expect(res.status).toBe(200);
  });

  it('静的配信の音声も、トークンがないと 401。クエリのトークンなら読める', async () => {
    const server = app.getHttpServer() as App;
    expect((await request(server).get('/audio/a.mp3')).status).toBe(401);
    expect(
      (await request(server).get(`/audio/a.mp3?token=${TOKEN}`)).status,
    ).toBe(200);
  });
});
