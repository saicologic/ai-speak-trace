import { describe, it, expect } from 'vitest';
import { markdownToSafeHtml } from './markdownHtml';

describe('markdownToSafeHtml', () => {
  it('AI の回答に混ざった HTML のスクリプト・イベント属性を取り除く', () => {
    const answer =
      '回答です。\n\n<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>\n\n<p onmouseover="alert(3)">本文</p>';
    const html = markdownToSafeHtml(answer);
    expect(html).not.toMatch(/onerror|onmouseover|<script|alert/);
    expect(html).toContain('回答です。');
    expect(html).toContain('本文');
  });

  it('javascript: のリンクは、リンク先を取り除く', () => {
    const html = markdownToSafeHtml('[押して](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('押して');
  });

  it('リンク先に引用符を入れて属性を足すことはできない', () => {
    const html = markdownToSafeHtml('[x](https://example.com/"onmouseover="alert(1))');
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(a?.getAttribute('onmouseover')).toBeNull();
  });

  it('https のリンクは、新しいタブで開く（外部のブラウザで開くため）', () => {
    const html = markdownToSafeHtml('[公式](https://example.com/docs)');
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com/docs');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
