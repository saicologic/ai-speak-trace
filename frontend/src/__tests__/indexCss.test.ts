import indexCss from '../index.css?raw';

/** CSS の文字列から、コメントを除く */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * アプリ全体のスタイル（index.css）
 * Tailwind CSS の色・文字の大きさ・クラスを使えるようにする。
 * まだ Tailwind に移していない画面の見た目を変えないように、Preflight（ブラウザの既定のスタイルを消す部分）は読み込まない
 */
describe('index.css', () => {
  it('Tailwind の theme と utilities を読み込み、Preflight は読み込まない', () => {
    const css = withoutComments(indexCss);
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(css).toContain('@import "tailwindcss/utilities.css" layer(utilities);');
    expect(css).not.toMatch(/@import "tailwindcss(\/preflight(\.css)?)?"/);
  });
});
