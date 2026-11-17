import indexCss from '../index.css?raw';

/** CSS の文字列から、コメントを除く */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * `@layer base { ... }` のように、名前と { で始まるブロックを、中の { } の組を数えて切り出す（中身と、外に残る部分に分ける）
 * `@layer base;` のように { のない書き方は、ブロックとして扱わない（外に残す）
 */
const splitBlocks = (css: string, opener: RegExp): { inside: string; outside: string } => {
  const pattern = new RegExp(`${opener.source}\\s*\\{`, 'g');
  let inside = '';
  let outside = '';
  let last = 0;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    if (match.index < last) continue;
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < css.length && depth > 0; end++) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') depth--;
    }
    outside += css.slice(last, match.index);
    inside += css.slice(match.index + match[0].length, end - 1);
    last = end;
    pattern.lastIndex = end;
  }
  return { inside, outside: outside + css.slice(last) };
};

/** CSS の文字列から、ルールのセレクターを取り出す（@ で始まる行は除く） */
const selectorsOf = (css: string): string[] =>
  [...css.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));

/** CSS の文字列から、セレクターごとの宣言を取り出す（空白と改行を詰める） */
const declarationsOf = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[{};])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
};

const themeOf = (css: string): string => splitBlocks(withoutComments(css), /@theme/).inside;

/** Tailwind v3 の色の値（今の画面で使っている値） */
const v3Palette: Record<string, string[]> = {
  gray: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827'],
  blue: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'],
  red: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
  amber: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
  green: ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'],
  violet: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'],
  yellow: ['#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12'],
};
const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

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
    // Preflight だけを読む書き方も、Preflight を含む全部を読む書き方（tailwindcss・tailwindcss/index.css）も使わない
    expect(css).not.toMatch(/preflight/i);
    expect(css).not.toMatch(/@import\s+(url\(\s*)?["']tailwindcss(\/index(\.css)?)?["']/);
  });

  it('要素に当てる設定（:root・*・body・button・input）は @layer base の中にだけ書く（@layer の外に書くと、Tailwind のクラスより強くなり、クラスが効かない）', () => {
    const { inside, outside } = splitBlocks(withoutComments(indexCss), /@layer\s+base/);
    // :where(button) や :is(button, input) のように、かっこの中に書いたものも見つける
    const elementSelector = /(^|[\s,>+~(])(:root|body|button|input)\b|(^|[\s,>+~(])\*/;
    expect(selectorsOf(outside).filter((s) => elementSelector.test(s))).toEqual([]);
    // 今の見た目を保つため、要素の設定そのものは残す
    const baseSelectors = selectorsOf(inside);
    for (const selector of [
      ':root',
      '*',
      'body',
      'button',
      'button:hover',
      'button:disabled',
      "input[type='text']",
      "input[type='text']:focus",
    ]) {
      expect(baseSelectors).toContain(selector);
    }
    // 中身を空にしても通らないように、主な宣言も確かめる
    expect(declarationsOf(inside, '*')).toContain('box-sizing: border-box;');
    expect(declarationsOf(inside, 'button')).toContain('border-radius: 6px;');
    expect(declarationsOf(inside, 'button:disabled')).toContain('opacity: 0.5;');
    expect(declarationsOf(inside, "input[type='text']:focus")).toContain('border-color: #3b82f6;');
  });

  it('色は、Tailwind の標準の色（oklch）を消し、今の画面と同じ 16 進の値で決めた色だけを使えるようにする', () => {
    const theme = themeOf(indexCss);
    // 標準の色を消す指定は、自分で決めた色より前に書く（後ろに書くと、決めた色まで消える）
    const reset = theme.indexOf('--color-*: initial;');
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThan(theme.search(/--color-[^*:\s]+:/));
    // 名前に大文字や _ がある色も取り出す
    const colors = Object.fromEntries(
      [...theme.matchAll(/--(color-[^:\s*]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    // 役割で呼ぶ色（ボタン・ヘッダー・背景）
    expect(colors).toMatchObject({
      'color-primary': '#3b82f6',
      'color-primary-hover': '#2563eb',
      'color-danger': '#dc2626',
      'color-danger-hover': '#b91c1c',
      'color-brand': '#1a1a2e',
      'color-brand-hover': '#2d2d4e',
      'color-brand-muted': '#a0a0b8',
      'color-canvas': '#f5f5f7',
      'color-white': '#ffffff',
      'color-black': '#000000',
    });
    // 灰・青・赤などの段階は、全部、今の画面で使っている値（Tailwind v3 の値）にする
    const palette = Object.fromEntries(
      Object.entries(v3Palette).flatMap(([name, values]) =>
        values.map((value, i) => [`color-${name}-${steps[i]}`, value]),
      ),
    );
    expect(colors).toMatchObject(palette);
    // どの色も 16 進で書く（oklch などで書いた色を混ぜない）
    expect(Object.entries(colors).filter(([, value]) => !/^#[0-9a-f]{6}$/.test(value))).toEqual([]);
  });

  it('文字の大きさは、標準の段階を消して決めた 8 段階だけにし、行の高さは決めない（画面全体の 1.6 を受け継ぐ）', () => {
    const theme = themeOf(indexCss);
    // 標準の段階を消す指定は、自分で決めた大きさより前に書く
    const reset = theme.indexOf('--text-*: initial;');
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThan(theme.search(/--text-[^*:\s]+:/));
    const sizes = Object.fromEntries(
      [...theme.matchAll(/--(text-[a-z0-9]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    expect(sizes).toEqual({
      'text-2xs': '0.7rem',
      'text-xs': '0.75rem',
      'text-sm': '0.8rem',
      'text-md': '0.85rem',
      'text-base': '0.9rem',
      'text-lg': '1rem',
      'text-xl': '1.25rem',
      'text-2xl': '1.5rem',
    });
    // Tailwind の text-* は、行の高さの変数があると行の高さも変える。今の画面に合わせ、行の高さは書かない
    expect(theme).not.toMatch(/--text-[^:\s]+--line-height/);
  });
});
