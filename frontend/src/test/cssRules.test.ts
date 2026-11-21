import { cssSelectsClass } from './cssRules';

/**
 * CSS の文字列が、目印のクラスをセレクターで指定しているかを確かめる補助のテスト
 * （宣言の値やコメントに書いた文字は、指定に数えない）
 */
describe('cssSelectsClass', () => {
  it.each([
    ['.sidebar { color: red; }', 'クラスだけのセレクター'],
    ['.sidebar:hover { color: red; }', '疑似クラスを付けたもの'],
    ['main > .sidebar.open { color: red; }', '子の組み合わせ・クラスを重ねたもの'],
    ['.a, .sidebar { color: red; }', 'カンマで並べたものの 2 つ目'],
    ['@media (min-width: 600px) { .sidebar { color: red; } }', '@media の中'],
    ['[data-x="a"] .sidebar { color: red; }', '引用符を使う属性セレクターの後'],
    ['.other::after { content: "{"; } .sidebar { color: red; }', '{ を含む文字列のあとのルール'],
  ])('%s は指定に数える（%s）', (css) => {
    expect(cssSelectsClass(css, 'sidebar')).toBe(true);
  });

  it.each([
    ['.other::after { content: ".sidebar"; }', '宣言の値の文字'],
    ['.other::after { content: "{.sidebar{"; }', '宣言の値の文字列の中の { '],
    [".other::after { content: '}.sidebar{'; }", '一重引用符の文字列の中の } と {'],
    ['.other::after { content: "\\"{.sidebar{"; }', '文字列の中でエスケープした引用符の後'],
    ['.other { background: url(./x.sidebar.png); }', '宣言の値の URL'],
    ['/* .sidebar { color: red; } */ .other { color: red; }', 'コメントの中'],
    ['.sidebar-right { color: red; }', '名前の続く別のクラス'],
    ['.mysidebar { color: red; }', '名前の前に文字のある別のクラス'],
  ])('%s は指定に数えない（%s）', (css) => {
    expect(cssSelectsClass(css, 'sidebar')).toBe(false);
  });
});
