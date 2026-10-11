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

  it('SVG の xlink:href に入った javascript: も取り除く', () => {
    const result = sanitizeHtml(
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    );
    expect(result).not.toMatch(/javascript:/);
  });

  it('SVG のアニメーション要素と、文脈で解釈が変わる要素を取り除く', () => {
    const result = sanitizeHtml(
      '<svg><a href="#c1"><set attributeName="href" to="javascript:alert(1)"/>' +
        '<animate attributeName="href" values="javascript:alert(1)"/>' +
        '<animateMotion path="M0,0"/><text>x</text></a></svg>' +
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>' +
        '<template><p>t</p></template><base href="https://evil.example/">',
    );
    expect(result).not.toMatch(/<set|<animate|noscript|<template|<base|javascript:|onerror/i);
    expect(result).toContain('<text>x</text>');
  });
});
