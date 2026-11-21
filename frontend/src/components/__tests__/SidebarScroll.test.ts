import appCss from '../../App.css?raw';

/** CSS の文字列から、セレクターに書いた宣言を取り出す（コメントを除き、空白と改行を詰める） */
const declarationsOf = (css: string, selector: string): string => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = withoutComments.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
};

/**
 * トップ画面の左のサイドバー
 * 音声ファイルの一覧だけをスクロールする（TranscriptionList.test.tsx で確かめる）。
 * 画面が低くて一覧の最低の高さを保てないときだけ、サイドバー全体をスクロールする（どの高さでも、全部のボタンと履歴に届くようにする）
 */
describe('トップ画面の左のサイドバーのスクロール', () => {
  it('サイドバーは縦に並べ、入りきらないときだけ全体をスクロールする', () => {
    const sidebar = declarationsOf(appCss, '.app-sidebar');
    expect(sidebar).toContain('display: flex;');
    expect(sidebar).toContain('flex-direction: column;');
    expect(sidebar).toContain('overflow-y: auto;');
    expect(sidebar).not.toContain('overflow: hidden;');
  });
});
