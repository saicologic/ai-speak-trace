import { useMemo, useState } from 'react';
import type { Keyword } from '../types';
import './KeywordList.css';

interface Props {
  keywords: Keyword[];
  highlightedKeywords: Set<string>;
  onToggleKeyword: (keyword: string) => void;
  onNavigateInterview?: () => void;
}

/** キーワード一覧コンポーネント（右サイドバー） */
export function KeywordList({
  keywords,
  highlightedKeywords,
  onToggleKeyword,
  onNavigateInterview,
}: Props) {
  const [filter, setFilter] = useState('');

  const filteredKeywords = useMemo(() => {
    if (!filter) return keywords;
    const lower = filter.toLowerCase();
    return keywords.filter((kw) => kw.text.toLowerCase().includes(lower));
  }, [keywords, filter]);

  if (keywords.length === 0) {
    return (
      <div className="keyword-list">
        <h2>キーワード</h2>
        <p className="keyword-list-empty">キーワードが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="keyword-list">
      {onNavigateInterview && (
        <button
          className="keyword-interview-button"
          onClick={onNavigateInterview}
        >
          ユーザーインタビュー
        </button>
      )}
      <div className="keyword-list-header">
        <h2>キーワード</h2>
        <span className="keyword-list-count">{filteredKeywords.length}件</span>
      </div>
      <input
        type="text"
        className="keyword-filter"
        placeholder="キーワードを検索..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <p className="keyword-list-hint">
        クリックでハイライト切替
      </p>
      <ul className="keyword-list-items">
        {filteredKeywords.map((keyword) => {
          const isActive = highlightedKeywords.has(keyword.text);
          return (
            <li key={keyword.text}>
              <button
                className={`keyword-item ${isActive ? 'active' : ''}`}
                onClick={() => onToggleKeyword(keyword.text)}
              >
                <span className="keyword-item-text">{keyword.text}</span>
                <span className="keyword-item-count">{keyword.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
