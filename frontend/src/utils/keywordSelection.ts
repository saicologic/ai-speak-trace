import type { Keyword } from '../types';

/**
 * 選んでいた語のうち、今の一覧にある語だけを残す（キーワードの出し方を切り替えたとき）
 * 変わらない場合は同じ Set を返す（再描画を増やさないため）
 */
export function keepAvailable(selected: Set<string>, keywords: Keyword[]): Set<string> {
  if (selected.size === 0) return selected;
  const available = new Set(keywords.map((k) => k.text));
  const kept = [...selected].filter((text) => available.has(text));
  return kept.length === selected.size ? selected : new Set(kept);
}
