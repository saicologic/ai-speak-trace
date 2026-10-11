/**
 * 取り除く要素（スクリプトの実行や外部コンテンツの埋め込みに使われるもの）
 * noscript などは、解析する文脈によって中身の解釈が変わるため取り除く
 * SVG のアニメーション要素は、リンク先を後から javascript: に書き換えられるため取り除く
 */
const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'input', 'button', 'textarea', 'select',
  'noscript', 'noembed', 'noframes', 'template',
  'animate', 'animatemotion', 'animatetransform', 'set',
]);

/**
 * Markdown から作った HTML を、表示しても安全な形にする
 * Web の情報を含む AI の出力を表示するため、スクリプトやイベント属性、javascript: のリンクを取り除く
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // SVG の要素名は大文字を含む（animateMotion など）ため、小文字にして比べる
  doc.querySelectorAll('*').forEach((el) => {
    if (BLOCKED_TAGS.has(el.localName.toLowerCase())) el.remove();
  });
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset') {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction') && !/^(https?:|#|mailto:)/.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
