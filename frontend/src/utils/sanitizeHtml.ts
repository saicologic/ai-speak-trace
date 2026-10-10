/** 取り除く要素（スクリプトの実行や外部コンテンツの埋め込みに使われるもの） */
const BLOCKED_TAGS = 'script, style, iframe, object, embed, link, meta, form, input, button, textarea, select';

/**
 * Markdown から作った HTML を、表示しても安全な形にする
 * Web の情報を含む AI の出力を表示するため、スクリプトやイベント属性、javascript: のリンクを取り除く
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(BLOCKED_TAGS).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset') {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src') && !/^(https?:|#|mailto:)/.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
