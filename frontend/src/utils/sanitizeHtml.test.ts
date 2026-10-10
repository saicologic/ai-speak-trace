import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('スクリプト・イベント属性・javascript: のリンクを取り除く', () => {
    const html =
      '<p onclick="x()">本文<script>alert(1)</script></p>' +
      '<a href="javascript:alert(1)">危険</a>' +
      '<img src="x" onerror="alert(1)">' +
      '<iframe src="https://example.com"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toMatch(/script|onclick|onerror|javascript:|iframe/);
    expect(result).toContain('本文');
    expect(result).toContain('<a>危険</a>');
  });

  it('通常のリンクや見出しは残す', () => {
    const html = '<h2>見出し</h2><a href="https://example.com" target="_blank">公式</a><a href="#c1">[1]</a>';
    expect(sanitizeHtml(html)).toBe(html);
  });
});
