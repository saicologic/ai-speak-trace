import { Marked } from 'marked';
import { sanitizeHtml } from './sanitizeHtml';

/** 画面に出す Markdown の変換（グローバルの marked の設定に左右されないよう、専用のインスタンスを使う） */
const markdown = new Marked({ async: false });

/**
 * AI の出力（Web の情報を含む Markdown）を、表示しても安全な HTML にする
 * - sanitizeHtml でスクリプト・イベント属性・javascript: のリンクなどを取り除く
 * - リンクは新しいタブで開く（Tauri では shell プラグインが外部のブラウザで開く）
 */
export function markdownToSafeHtml(source: string): string {
  const html = sanitizeHtml(markdown.parse(source) as string);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return doc.body.innerHTML;
}
