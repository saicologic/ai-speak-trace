import indexCss from '../index.css?raw';

/** CSS の文字列から、コメントを除く */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `@layer base { ... }` のように、名前で始まるブロックを、中の { } の組を数えて切り出す（中身と、外に残る部分に分ける） */
const splitBlocks = (css: string, opener: string): { inside: string; outside: string } => {
  let inside = '';
  let outside = '';
  let rest = css;
  for (;;) {
    const start = rest.indexOf(opener);
    if (start < 0) break;
    const open = rest.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++;
      if (rest[end] === '}' && --depth === 0) break;
    }
    outside += rest.slice(0, start);
    inside += rest.slice(open + 1, end);
    rest = rest.slice(end + 1);
  }
  return { inside, outside: outside + rest };
};

/** CSS の文字列から、ルールのセレクターを取り出す（@ で始まる行は除く） */
const selectorsOf = (css: string): string[] =>
  [...css.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));

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

  it('要素に当てる設定（:root・*・body・button・input）は @layer base の中にだけ書く（@layer の外に書くと、Tailwind のクラスより強くなり、クラスが効かない）', () => {
    const { inside, outside } = splitBlocks(withoutComments(indexCss), '@layer base');
    const elementSelector = /(^|[\s,>+~])(:root|\*|body|button|input)\b|(^|[\s,])\*/;
    expect(selectorsOf(outside).filter((s) => elementSelector.test(s))).toEqual([]);
    // 今の見た目を保つため、要素の設定そのものは残す
    const baseSelectors = selectorsOf(inside);
    for (const selector of [':root', '*', 'body', 'button', 'button:disabled', "input[type='text']"]) {
      expect(baseSelectors).toContain(selector);
    }
  });
});
