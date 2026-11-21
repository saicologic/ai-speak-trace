import { expect, test, type Page } from '@playwright/test';
import { fakeTranscriptions, isApi, mockApi } from './mockApi';

/**
 * トップ画面の左のサイドバー（文字起こし履歴）
 * 「文字起こし履歴」の見出しとサイドバーのボタンは固定し、音声ファイルの一覧だけをスクロールする。
 * 一覧には最低の高さ（160px）を持たせ、画面が低くてそれを保てないときだけ、サイドバー全体をスクロールする
 */

const SIDEBAR = 'aside.app-sidebar';
const LIST = '.transcription-list ul';

/** 項目のボタン（名前の後に日付が続く。名前で始まる削除ボタンとは分ける） */
const item = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d`) });
const deleteButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name} の文字起こしを削除` });

/** 要素の上下左右（画面の中の位置） */
const boxOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  });

/**
 * 利用者がスクロールできるか（中身があふれ、overflow-y が auto か scroll）
 * overflow: hidden でも scrollHeight は大きくなるため、overflow-y も確かめる
 */
const canScroll = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const { overflowY } = getComputedStyle(el);
    return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  });

const scrollTopOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.scrollTop);

/** 要素の上にマウスを置いて、ホイールで下にスクロールする（利用者と同じ操作で、スクロールする要素を確かめる） */
async function wheelOver(page: Page, selector: string, deltaY: number) {
  const box = await boxOf(page, selector);
  await page.mouse.move(box.left + 20, box.top + Math.min(40, box.height / 2));
  await page.mouse.wheel(0, deltaY);
}

/** 作り物の一覧で、トップ画面を開く */
async function openTop(page: Page, count: number) {
  await mockApi(page, fakeTranscriptions(count));
  await page.goto('/');
  await expect(item(page, 'sample-01.mp3')).toBeVisible();
}

test.describe('文字起こし履歴のスクロール', () => {
  test('ふつうの高さでは、一覧だけがスクロールし、見出しとサイドバーは動かない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTop(page, 30);

    expect(await canScroll(page, LIST)).toBe(true);
    expect(await canScroll(page, SIDEBAR)).toBe(false);

    // 一覧の上でホイールを回すと、一覧だけがスクロールする
    await wheelOver(page, LIST, 5000);
    await expect.poll(() => scrollTopOf(page, LIST)).toBeGreaterThan(0);
    expect(await scrollTopOf(page, SIDEBAR)).toBe(0);
    await expect(page.getByRole('heading', { name: '文字起こし履歴', level: 2 })).toBeInViewport();
    // 一覧の最後の項目まで、一覧の中のスクロールで届く
    await expect(item(page, 'sample-30.mp3')).toBeInViewport();
  });

  test('画面が低くて長いエラーが出ても、一覧は 160px を保ち、サイドバー全体のスクロールで届く', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await openTop(page, 30);

    // 一覧を取り直して失敗すると、項目を残したまま、長いエラー文を出す
    await page.route(isApi('/transcriptions'), (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: '取得できませんでした。'.repeat(20) }),
    );
    await page.getByRole('button', { name: '更新' }).click();
    const error = page.getByText(/文字起こし一覧の取得に失敗しました/);
    await expect(error).toBeVisible();

    const listBox = await boxOf(page, LIST);
    expect(listBox.height).toBeGreaterThanOrEqual(159.5);
    // エラー文は縮まず（文字がはみ出さず）、一覧の上に重ならない
    expect(await error.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    const errorBox = await error.boundingBox();
    expect(errorBox && errorBox.y + errorBox.height).toBeLessThanOrEqual(listBox.top + 0.5);

    // サイドバーの上でホイールを回すと、サイドバー全体がスクロールし、一覧の下まで届く
    expect(await canScroll(page, SIDEBAR)).toBe(true);
    await wheelOver(page, SIDEBAR, 5000);
    await expect
      .poll(async () => (await boxOf(page, LIST)).bottom - (await boxOf(page, SIDEBAR)).bottom)
      .toBeLessThanOrEqual(0.5);
    // 一覧の中もスクロールでき、最後の項目に届く
    expect(await canScroll(page, LIST)).toBe(true);
    await wheelOver(page, LIST, 5000);
    await expect(item(page, 'sample-30.mp3')).toBeInViewport();
  });
});

test.describe('文字起こし履歴の項目と削除ボタン', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTop(page, 3);
  });

  test('削除ボタンは、ふだんは見えず、項目にカーソルを乗せると見える', async ({ page }) => {
    // ふだんは白の背景・灰色の枠で、削除ボタンは見えない
    await expect(item(page, 'sample-02.mp3')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(item(page, 'sample-02.mp3')).toHaveCSS('border-top-color', 'rgb(229, 231, 235)');
    await expect(deleteButton(page, 'sample-02.mp3')).toHaveCSS('opacity', '0');

    await item(page, 'sample-02.mp3').hover();

    await expect(item(page, 'sample-02.mp3')).toHaveCSS('background-color', 'rgb(240, 253, 244)');
    await expect(item(page, 'sample-02.mp3')).toHaveCSS('border-top-color', 'rgb(134, 239, 172)');
    await expect(deleteButton(page, 'sample-02.mp3')).toHaveCSS('opacity', '1');
    // ほかの項目の削除ボタンは見えないまま
    await expect(deleteButton(page, 'sample-01.mp3')).toHaveCSS('opacity', '0');
    // 削除ボタンは、項目の枠の中の右上に重なる
    const itemBox = await item(page, 'sample-02.mp3').boundingBox();
    const buttonBox = await deleteButton(page, 'sample-02.mp3').boundingBox();
    if (!itemBox || !buttonBox) throw new Error('項目か削除ボタンの位置を取れませんでした');
    const top = buttonBox.y - itemBox.y;
    const right = itemBox.x + itemBox.width - (buttonBox.x + buttonBox.width);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(10);
    expect(right).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThan(10);
  });

  test('削除ボタンは、キーボードで移ったときにも見える', async ({ page }) => {
    await item(page, 'sample-01.mp3').focus();
    await page.keyboard.press('Tab');

    await expect(deleteButton(page, 'sample-01.mp3')).toBeFocused();
    await expect(deleteButton(page, 'sample-01.mp3')).toHaveCSS('opacity', '1');
  });

  test('選んだ項目は濃い緑の枠にし、カーソルを乗せても色を変えない', async ({ page }) => {
    await item(page, 'sample-01.mp3').click();
    // 文字起こしの中身の取得はまねていないので失敗するが、選んだ状態は残る
    await expect(item(page, 'sample-01.mp3')).toBeEnabled();

    await item(page, 'sample-01.mp3').hover();

    await expect(item(page, 'sample-01.mp3')).toHaveCSS('border-top-color', 'rgb(34, 197, 94)');
    await expect(item(page, 'sample-01.mp3')).toHaveCSS('background-color', 'rgb(240, 253, 244)');
  });

  test('「更新」ボタンは、ふつうのボタンより小さい', async ({ page }) => {
    const reload = page.getByRole('button', { name: '更新' });

    await expect(reload).toHaveCSS('font-size', '12px');
    await expect(reload).toHaveCSS('padding', '3.6px 7.2px');
  });
});
