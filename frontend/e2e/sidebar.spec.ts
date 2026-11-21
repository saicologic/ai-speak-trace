import { expect, test, type Page } from '@playwright/test';
import { fakeTranscriptions, isApi, mockApi } from './mockApi';

/**
 * トップ画面の左のサイドバー（文字起こし履歴）
 * 「文字起こし履歴」の見出しとサイドバーのボタンは固定し、音声ファイルの一覧だけをスクロールする。
 * 一覧には最低の高さ（160px）を持たせ、画面が低くてそれを保てないときだけ、サイドバー全体をスクロールする
 */

const sidebar = (page: Page) => page.locator('aside.app-sidebar');
const list = (page: Page) => page.locator('.transcription-list ul');
const heading = (page: Page) => page.getByRole('heading', { name: '文字起こし履歴', level: 2 });
/** 項目のボタン（名前の後に日付が続く。名前で始まる削除ボタンとは分ける） */
const item = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d`) });
const deleteButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name} の文字起こしを削除` });

/** 要素がスクロールできるか（中身が見えている高さより大きいか） */
const isScrollable = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.scrollHeight > el.clientHeight);

/** 要素の上端・下端・高さ（画面の中の位置） */
const boxOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });

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

    expect(await isScrollable(page, '.transcription-list ul')).toBe(true);
    expect(await isScrollable(page, 'aside.app-sidebar')).toBe(false);

    const headingTop = (await heading(page).boundingBox())?.y;
    await list(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect((await heading(page).boundingBox())?.y).toBe(headingTop);
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

    const listBox = await boxOf(page, '.transcription-list ul');
    expect(listBox.height).toBeGreaterThanOrEqual(159.5);
    // エラー文は縮んで一覧に重ならない
    const errorBox = await error.boundingBox();
    expect(errorBox && errorBox.y + errorBox.height).toBeLessThanOrEqual(listBox.top + 0.5);

    // サイドバー全体をスクロールすると、一覧の下まで届く
    expect(await isScrollable(page, 'aside.app-sidebar')).toBe(true);
    await sidebar(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const sidebarBox = await boxOf(page, 'aside.app-sidebar');
    const scrolledListBox = await boxOf(page, '.transcription-list ul');
    expect(scrolledListBox.bottom).toBeLessThanOrEqual(sidebarBox.bottom + 0.5);
    // 一覧の中もスクロールでき、最後の項目に届く
    expect(await isScrollable(page, '.transcription-list ul')).toBe(true);
    await list(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(item(page, 'sample-30.mp3')).toBeInViewport();
  });
});

test.describe('文字起こし履歴の項目と削除ボタン', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTop(page, 3);
  });

  test('削除ボタンは、ふだんは見えず、項目にカーソルを乗せると見える', async ({ page }) => {
    await expect(deleteButton(page, 'sample-02.mp3')).toHaveCSS('opacity', '0');

    await item(page, 'sample-02.mp3').hover();

    await expect(item(page, 'sample-02.mp3')).toHaveCSS('background-color', 'rgb(240, 253, 244)');
    await expect(item(page, 'sample-02.mp3')).toHaveCSS('border-top-color', 'rgb(134, 239, 172)');
    await expect(deleteButton(page, 'sample-02.mp3')).toHaveCSS('opacity', '1');
    // ほかの項目の削除ボタンは見えないまま
    await expect(deleteButton(page, 'sample-01.mp3')).toHaveCSS('opacity', '0');
    // 削除ボタンは項目の右上に重なる
    const itemBox = await item(page, 'sample-02.mp3').boundingBox();
    const buttonBox = await deleteButton(page, 'sample-02.mp3').boundingBox();
    expect(buttonBox && itemBox && buttonBox.y - itemBox.y).toBeLessThan(10);
    expect(buttonBox && itemBox && itemBox.x + itemBox.width - (buttonBox.x + buttonBox.width)).toBeLessThan(10);
  });

  test('削除ボタンは、キーボードでフォーカスしたときにも見える', async ({ page }) => {
    await deleteButton(page, 'sample-01.mp3').focus();

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
