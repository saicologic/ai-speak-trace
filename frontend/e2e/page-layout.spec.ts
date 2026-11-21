import { expect, test } from '@playwright/test';
import { fakeTranscriptions, mockApi } from './mockApi';

/**
 * ページの外枠（PageLayout）
 * ヘッダー（戻るボタン・タイトル・タブ）を画面の上に固定し、本文だけをスクロールする
 */
test('本文が長くても、本文だけがスクロールし、ヘッダーは画面の上に残る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await mockApi(page, fakeTranscriptions(1));
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByRole('heading', { name: '設定', level: 1 })).toBeVisible();

  // 本文を長くする（設定の画面の中身の量によらず、スクロールが出るようにする）
  const scroll = page.locator('.page-layout-scroll');
  await scroll.evaluate((el) => {
    const tall = document.createElement('div');
    tall.style.height = '3000px';
    tall.style.flexShrink = '0';
    el.appendChild(tall);
  });
  // overflow: hidden でもあふれは出るため、利用者がスクロールできる overflow-y かも確かめる
  expect(await scroll.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');

  // 本文の上でホイールを回すと、本文だけがスクロールする（本文がスクロールできないと、ページ全体が動く）
  const box = await scroll.boundingBox();
  if (!box) throw new Error('本文の位置を取れませんでした');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // 外枠とページ全体はスクロールしない
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('.page-layout').evaluate((el) => el.scrollTop)).toBe(0);
  // ヘッダーは画面の上に残り、戻るボタンを押せる
  expect((await page.locator('.page-layout-fixed').boundingBox())?.y).toBe(0);
  await expect(page.getByRole('button', { name: '← 戻る' })).toBeInViewport();
});
