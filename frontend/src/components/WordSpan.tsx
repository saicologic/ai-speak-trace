import { useMemo } from 'react';
import type { TranscriptionWord } from '../types';
import './WordSpan.css';

interface Props {
  word: TranscriptionWord;
  isSelected: boolean;
  highlightedKeywords: Set<string>;
  onClick: () => void;
  onTimeClick?: (startTime: number) => void;
}

/** 時間を mm:ss 形式に変換 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** テキスト内のキーワード部分を <mark> で囲んでレンダリング */
function renderHighlightedText(
  text: string,
  keywords: Set<string>,
): React.ReactNode {
  if (keywords.size === 0) return text;

  // 複合キーワードを個別パーツにも展開する
  // (フレーズ分割で別WordSpanになるケースに対応)
  const expanded = new Set<string>();
  for (const kw of keywords) {
    expanded.add(kw);
    // スペース区切り (Kotoba Technologies → Kotoba, Technologies)
    if (kw.includes(' ')) {
      for (const part of kw.split(/\s+/)) {
        if (part.length >= 2) expanded.add(part);
      }
    }
    // 文字体系の境界で分割 (富岳LLM → 富岳, LLM / AIエコシステム → AI, エコシステム)
    const scriptParts = kw.match(
      /[A-Za-z0-9]+|[ァ-ヴー・]+|[一-龯々]+|[ぁ-ん]+/g,
    );
    if (scriptParts && scriptParts.length > 1) {
      for (const part of scriptParts) {
        if (part.length >= 2) expanded.add(part);
      }
    }
  }

  // キーワードを長い順にソート（長いマッチを優先）
  const sorted = Array.from(expanded).sort((a, b) => b.length - a.length);
  const escaped = sorted.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');

  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    expanded.has(part) ? (
      <mark key={i} className="keyword-highlight">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** 個別単語コンポーネント */
export function WordSpan({
  word,
  isSelected,
  highlightedKeywords,
  onClick,
  onTimeClick,
}: Props) {
  const highlightedContent = useMemo(
    () => renderHighlightedText(word.text, highlightedKeywords),
    [word.text, highlightedKeywords],
  );

  if (word.type === 'spacing') {
    return <span className="word-spacing">{word.text}</span>;
  }

  if (word.type === 'audio_event') {
    return (
      <span className="word-audio-event" title={`${formatTime(word.start)}`}>
        {word.text}
      </span>
    );
  }

  return (
    <span
      className={`word-span ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        onClick();
        onTimeClick?.(word.start);
      }}
      title={`${formatTime(word.start)} - ${formatTime(word.end)}`}
    >
      {highlightedContent}
    </span>
  );
}
