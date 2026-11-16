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
 * ボタン・「履歴」・「文字起こし履歴」の見出しは固定し、音声ファイルの一覧だけをスクロールする
 */
describe('トップ画面の左のサイドバーのスクロール', () => {
  it('サイドバー全体はスクロールさせない', () => {
    const sidebar = declarationsOf(appCss, '.app-sidebar');
    expect(sidebar).toContain('overflow: hidden;');
    expect(sidebar).not.toContain('overflow-y: auto;');
    expect(sidebar).toContain('flex-direction: column;');
  });

  it('文字起こし履歴は、サイドバーの残りの高さを使う', () => {
    const list = declarationsOf(transcriptionListCss, '.transcription-list');
    expect(list).toContain('flex: 1;');
    expect(list).toContain('min-height: 0;');
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
