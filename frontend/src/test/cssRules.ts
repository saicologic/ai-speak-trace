/**
 * Tailwind に移した部品のテストで使う、クラスと CSS を確かめる補助
 * （@layer の外に書いた CSS は Tailwind のクラスより強いため、移した部品の前の指定が残っていないかを確かめる）
 */

/**
 * src の全部の CSS ファイルの中身。キーは src から見たパス（例: `components/SettingsPage.css`・`App.css`）
 * import.meta.glob のキーは呼び出したファイルから見た相対パスになるため、src から見たパスに直す
 */
export const allCss: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, css]) => [path.replace(/^\.\.\//, ''), css]),
);

/** CSS の文字列から、コメントを除く */
export const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * CSS の文字列から、ルールのセレクター（{ の前の部分）を取り出す
 * 宣言の値（content の文字・url() など）は、{ } の中にあるため含めない。@media などの条件も、ここでは含む
 */
const selectorsOf = (css: string): string[] =>
  [...withoutComments(css).matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim());

/**
 * CSS の文字列が、目印のクラスをセレクターで指定しているか
 * （.a.b・.a:hover・a > .b などを含む。.a-b のような別の名前と、宣言の値・コメントの中の文字は除く）
 */
export const cssSelectsClass = (css: string, className: string): boolean => {
  const pattern = new RegExp(`\\.${className}(?![\\w-])`);
  return selectorsOf(css).some((selector) => pattern.test(selector));
};

/** 目印のクラスを指定している CSS ファイルを、src から見たパスで返す */
export const cssFilesSelecting = (className: string): string[] =>
  Object.entries(allCss)
    .filter(([, css]) => cssSelectsClass(css, className))
    .map(([path]) => path);

/** 要素のクラスを、並びを問わない集まりにする */
export const classesOf = (element: Element | null): string[] =>
  element ? Array.from(element.classList).sort() : [];
