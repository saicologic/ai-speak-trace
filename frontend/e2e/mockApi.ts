import type { Page } from '@playwright/test';

/** 作り物の文字起こしの一覧（本物のデータは使わない） */
export const fakeTranscriptions = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `fake-${i + 1}`,
    audioFileName: `sample-${String(i + 1).padStart(2, '0')}.mp3`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 9, i)).toISOString(),
  }));

/**
 * API の URL か（パスが /api/ で始まるもの）
 * 「/api/ を含む URL」の glob だと、画面のプログラム（/src/api/client.ts）にも当たり、画面が起動しなくなる
 */
export const isApi = (path: string) => (url: URL) => url.pathname === `/api${path}`;
const isAnyApi = (url: URL) => url.pathname.startsWith('/api/');

/**
 * API をまねる
 * まねていない API は、全部 503 で断る（バックエンドにも、開発用の .backend-port の先にも届かせない）。
 * あとから足したまね（page.route）が先に使われるので、各テストで上書きできる
 */
export async function mockApi(page: Page, transcriptions: ReturnType<typeof fakeTranscriptions>) {
  await page.route(isAnyApi, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'テストでは使わない API' }),
  );
  await page.route(isApi('/transcriptions'), (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { transcriptions } })
      : route.fulfill({ status: 503, body: 'テストでは使わない API' }),
  );
}
