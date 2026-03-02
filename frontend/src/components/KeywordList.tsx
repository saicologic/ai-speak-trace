import type { Keyword } from '../types';
import './KeywordList.css';

interface Props {
  keywords: Keyword[];
  highlightedKeywords: Set<string>;
  onToggleKeyword: (keyword: string) => void;
}

/** キーワード一覧コンポーネント（右サイドバー） */
export function KeywordList({
  keywords,
  highlightedKeywords,
  onToggleKeyword,
}: Props) {
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
      <div className="keyword-list-header">
        <h2>キーワード</h2>
        <span className="keyword-list-count">{keywords.length}件</span>
      </div>
      <p className="keyword-list-hint">
        クリックでハイライト切替
      </p>
      <ul className="keyword-list-items">
        {keywords.map((keyword) => {
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
