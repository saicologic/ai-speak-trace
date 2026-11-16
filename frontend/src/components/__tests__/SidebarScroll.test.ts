import appCss from '../../App.css?raw';
import transcriptionListCss from '../TranscriptionList.css?raw';

/** CSS の文字列から、セレクターに書いた宣言を取り出す（コメントを除き、空白と改行を詰める） */
const declarationsOf = (css: string, selector: string): string => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = withoutComments.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
};

/**
 * トップ画面の左のサイドバー
 * ボタン・「履歴」・「文字起こし履歴」の見出しは固定し、音声ファイルの一覧だけをスクロールする。
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

  it('文字起こし履歴は、サイドバーの残りの高さを使い、画面が低くても一覧を見られる高さを保つ', () => {
    const list = declarationsOf(transcriptionListCss, '.transcription-list');
    expect(list).toContain('flex: 1;');
    expect(list).toContain('min-height: 160px;');
    expect(list).toContain('display: flex;');
    expect(list).toContain('flex-direction: column;');
  });

  it('音声ファイルの一覧だけが、長いときにスクロールする', () => {
    const items = declarationsOf(transcriptionListCss, '.transcription-list-items');
    expect(items).toContain('flex: 1;');
    expect(items).toContain('min-height: 0;');
    expect(items).toContain('overflow-y: auto;');
  });

  it('「文字起こし履歴」と更新ボタンの行は、一覧が長くても縮まない', () => {
    expect(declarationsOf(transcriptionListCss, '.transcription-list-header')).toContain('flex-shrink: 0;');
  });
});
