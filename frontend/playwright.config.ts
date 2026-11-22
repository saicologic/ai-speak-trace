import { defineConfig, devices } from '@playwright/test';

/**
 * 画面の見た目（高さ・スクロール・カーソルを乗せたときの表示）を、本物のブラウザで確かめるテスト
 * テストの画面（jsdom）は高さを計算しないため、レイアウトはここで確かめる。
 * API は各テストで page.route でまね、バックエンドと本物のデータは使わない（e2e/mockApi.ts）
 */

/** 開発用の画面（5173）とぶつからないように、別のポートで起動する */
const port = 5174;

export default defineConfig({
  testDir: './e2e',
  // CI では、テストを外したまま（.only）通らないようにする
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
