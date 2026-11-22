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

/** @theme のブロックの中身を集める（@theme inline { ... } のように、後ろに指定があるものも含める） */
const themeOf = (css: string): string => {
  const source = withoutComments(css);
  // 切り出せなかった @theme がないこと（読み落としたブロックの中は確かめられないため）
  expect(source.match(/@theme\b/g)?.length ?? 0).toBe(source.match(/@theme(?:\s+[a-z-]+)*\s*\{/g)?.length ?? 0);
  return splitBlocks(source, /@theme(?:\s+[a-z-]+)*/).inside;
};

/** Tailwind v3 の色の値（今の画面で使っている値） */
const v3Palette: Record<string, string[]> = {
  gray: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827'],
  blue: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'],
  red: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
  amber: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
  green: ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'],
  violet: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'],
  yellow: ['#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12'],
  emerald: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'],
  sky: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'],
  purple: ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87'],
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
    expect(css).not.toMatch(/@import\s+(url\(\s*)?["']?tailwindcss(\/index(\.css)?)?["']?\s*(\)|;|\s)/);
  });

  it('要素に当てる設定（:root・*・body・button・input など）は @layer base の中にだけ書く（@layer の外に書くと、Tailwind のクラスより強くなり、クラスが効かない）', () => {
    const { inside, outside } = splitBlocks(withoutComments(indexCss), /@layer\s+base/);
    // 要素の名前（html・textarea・a なども）・*・:root を見つける。:where(button) のように、かっこの中に書いたものも見つける
    // （. # [ : で始まるクラス・ID・属性・疑似クラスは要素ではない。@keyframes の from・to は除く）
    const elementSelector = /(^|[\s,>+~(])(?!(?:from|to)(?![\w-]))([a-z][a-z0-9-]*|\*|:root)(?![\w-])/;
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
    // 1 段階だけ使う色（要約・ディープサーチの背景など）
    expect(colors).toMatchObject({ 'color-slate-50': '#f8fafc', 'color-neutral-50': '#fafafa' });
    // どの色も 16 進で書く（oklch などで書いた色を混ぜない）
    expect(Object.entries(colors).filter(([, value]) => !/^#[0-9a-f]{6}$/.test(value))).toEqual([]);
  });

  it('文字の大きさは、標準の段階を消して決めた 11 段階だけにし、行の高さは決めない（画面全体の 1.6 を受け継ぐ）', () => {
    const theme = themeOf(indexCss);
    // 標準の段階を消す指定は、自分で決めた大きさより前に書く
    const reset = theme.indexOf('--text-*: initial;');
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThan(theme.search(/--text-[^*:\s]+:/));
    const sizes = Object.fromEntries(
      // 名前に大文字・_・- がある大きさも取り出す（--text-sm--line-height のような入れ子の変数も、ここで混ざれば失敗する）
      [...theme.matchAll(/--(text-[^:\s*]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    expect(sizes).toEqual({
      'text-2xs': '0.7rem',
      'text-xs': '0.75rem',
      'text-sm': '0.8rem',
      'text-md': '0.85rem',
      'text-base': '0.9rem',
      'text-base-plus': '0.95rem',
      'text-lg': '1rem',
      'text-lg-plus': '1.1rem',
      'text-xl-minus': '1.2rem',
      'text-xl': '1.25rem',
      'text-2xl': '1.5rem',
    });
    // Tailwind の text-* は、行の高さの変数があると行の高さも変える。今の画面に合わせ、行の高さは書かない
    expect(theme).not.toMatch(/--text-[^:\s]+--line-height/);
  });

  it('回るアニメーションは、今の画面と同じ 0.8 秒で 1 回転にする（Tailwind の animate-spin は 1 秒）', () => {
    const theme = themeOf(indexCss);
    expect(theme).toMatch(/--animate-spin-fast:\s*spin 0\.8s linear infinite;/);
  });

  it('会話に飛んだ発言は、薄い青から 2 秒で背景の色を消す', () => {
    const theme = themeOf(indexCss);
    expect(theme).toMatch(/--animate-jump-highlight:\s*jump-highlight-fade 2s ease-out;/);
    // @keyframes は @theme の中に書く（使ったときだけ CSS に出る）
    const keyframes = splitBlocks(theme, /@keyframes\s+jump-highlight-fade/).inside.replace(/\s+/g, ' ');
    expect(keyframes).toMatch(/0% \{ background-color: #bfdbfe; \}/);
    expect(keyframes).toMatch(/100% \{ background-color: transparent; \}/);
  });

  it('hover: のクラスは、今までの CSS の :hover と同じく、カーソルを乗せられない環境でも効くようにする', () => {
    // Tailwind v4 の hover: は、標準では @media (hover: hover) の中でだけ効き、タッチ操作などでは効かない
    expect(withoutComments(indexCss)).toMatch(/@custom-variant\s+hover\s+\(\s*&:hover\s*\)\s*;/);
  });
});
